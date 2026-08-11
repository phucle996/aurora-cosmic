"""Evaluation Cohort Construction & Identity Management (ml-evaluation-cohort-v1).

Builds Golden Test and Recent Holdout cohorts with strict group-level isolation.
"""

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import hashlib
import json
import os
from typing import Any, Dict, List, Optional, Tuple

from aurora_ml.ml.datasets.splits import CandidateGroupSplit, derive_group_key
from aurora_ml.pipeline.gold import GoldSnapshotManifest


class MlEvaluationError(Exception):
    """Base exception for ML evaluation failures."""

    pass


class EvaluationGroupLeakageError(MlEvaluationError):
    """Raised when evaluation cohort contains groups exposed to model training/validation."""

    pass


class EvaluationCohortConflictError(MlEvaluationError):
    """Raised when an immutable cohort manifest conflict is detected."""

    pass


class EvaluationRunConflictError(MlEvaluationError):
    """Raised when an immutable evaluation run manifest conflict is detected."""

    pass


class InsufficientClassCoverageError(MlEvaluationError):
    """Raised when an evaluation dataset lacks required class representations."""

    pass


@dataclass(frozen=True)
class EvaluationCohort:
    """Immutable evaluation cohort conforming to ml-evaluation-cohort-v1."""

    schema_version: int
    cohort_id: str
    cohort_fingerprint: str
    task: str
    cohort_kind: str
    source_gold_snapshot_id: str
    source_gold_manifest_sha256: str
    dataset_view_version: str
    dataset_view_fingerprint: str
    selection_policy_version: str
    excluded_group_cohort_ids: List[str]
    group_count: int
    row_count: int
    group_keys: List[str]
    created_at: str
    producer: str = "python-ml-worker"
    positive_count: Optional[int] = None
    negative_count: Optional[int] = None
    training_max_sector: Optional[int] = None

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        return {k: v for k, v in d.items() if v is not None}


def derive_cohort_identity(
    task: str,
    cohort_kind: str,
    source_gold_snapshot_id: str,
    source_gold_manifest_sha256: str,
    dataset_view_version: str,
    dataset_view_fingerprint: str,
    selection_policy_version: str,
    excluded_group_cohort_ids: List[str],
    group_keys: List[str],
) -> Tuple[str, str]:
    """Derive deterministic SHA-256 cohort fingerprint and ID."""
    canonical_obj = {
        "cohort_kind": cohort_kind,
        "dataset_view_fingerprint": dataset_view_fingerprint,
        "dataset_view_version": dataset_view_version,
        "excluded_group_cohort_ids": sorted(excluded_group_cohort_ids),
        "group_keys": sorted(group_keys),
        "selection_policy_version": selection_policy_version,
        "source_gold_manifest_sha256": source_gold_manifest_sha256,
        "source_gold_snapshot_id": source_gold_snapshot_id,
        "task": task,
    }
    canonical_json = json.dumps(canonical_obj, sort_keys=True, separators=(",", ":"))
    cohort_fp = hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()

    prefix = "cand" if task == "candidate_vetting" else "anom"
    kind_code = "gold" if cohort_kind == "GOLDEN_TEST" else "rec"
    cohort_id = f"cohort-{prefix}-{kind_code}-v1-{cohort_fp[:12]}"

    return cohort_id, cohort_fp


def check_group_contamination(
    cohort_group_keys: List[str],
    training_split: CandidateGroupSplit,
    other_cohort_group_keys: Optional[List[str]] = None,
) -> None:
    """Ensure evaluation target groups do not intersect with development or other cohorts."""
    dev_train_groups = {
        a.group_key for a in training_split.assignments if a.split == "TRAIN"
    }
    dev_val_groups = {
        a.group_key for a in training_split.assignments if a.split == "VALIDATION"
    }
    cohort_groups = set(cohort_group_keys)

    # Check intersection with TRAIN
    train_leakage = cohort_groups.intersection(dev_train_groups)
    if train_leakage:
        raise EvaluationGroupLeakageError(
            f"EVALUATION_GROUP_LEAKAGE: {len(train_leakage)} cohort groups intersect with TRAIN split"
        )

    # Check intersection with VALIDATION
    val_leakage = cohort_groups.intersection(dev_val_groups)
    if val_leakage:
        raise EvaluationGroupLeakageError(
            f"EVALUATION_GROUP_LEAKAGE: {len(val_leakage)} cohort groups intersect with VALIDATION split"
        )

    # Check intersection with other cohorts (e.g. Recent vs Golden)
    if other_cohort_group_keys:
        other_leakage = cohort_groups.intersection(set(other_cohort_group_keys))
        if other_leakage:
            raise EvaluationGroupLeakageError(
                f"EVALUATION_GROUP_LEAKAGE: {len(other_leakage)} cohort groups intersect with another evaluation cohort"
            )


def build_candidate_golden_cohort(
    gold_manifest: GoldSnapshotManifest,
    candidate_rows: List[Dict[str, Any]],
    training_split: Optional[Any] = None,
) -> EvaluationCohort:
    """Build candidate Golden Test cohort from committed Gold snapshot, excluding TRAIN & VALIDATION groups."""
    dev_groups = (
        {a.group_key for a in training_split.assignments}
        if training_split is not None
        else set()
    )

    # Filter supervised rows with labels POSITIVE / NEGATIVE
    supervised_rows = [
        r for r in candidate_rows if r.get("training_label") in ("POSITIVE", "NEGATIVE")
    ]

    # Group by astronomical target identity
    groups: Dict[str, List[Dict[str, Any]]] = {}
    for r in supervised_rows:
        gk = derive_group_key(r)
        if gk not in dev_groups:
            groups.setdefault(gk, []).append(r)

    if not groups:
        raise MlEvaluationError(
            "NO_UNSEEN_GROUPS: No unseen target groups available for Golden Test"
        )

    sorted_group_keys = sorted(groups.keys())
    eligible_rows = [r for gk in sorted_group_keys for r in groups[gk]]

    pos_c = sum(1 for r in eligible_rows if r.get("training_label") == "POSITIVE")
    neg_c = sum(1 for r in eligible_rows if r.get("training_label") == "NEGATIVE")

    if pos_c == 0 or neg_c == 0:
        raise InsufficientClassCoverageError(
            f"INSUFFICIENT_GOLDEN_CLASS_COVERAGE: Golden cohort requires >=1 POSITIVE ({pos_c}) and >=1 NEGATIVE ({neg_c})"
        )

    manifest_sha = hashlib.sha256(
        json.dumps(
            gold_manifest.to_dict(), sort_keys=True, separators=(",", ":")
        ).encode("utf-8")
    ).hexdigest()

    dview_version = (
        training_split.dataset_view_version
        if training_split is not None
        else "candidate-ml-view-v1"
    )
    dview_fp = (
        training_split.split_fingerprint if training_split is not None else ("0" * 64)
    )
    excluded_ids = [training_split.split_id] if training_split is not None else []

    cohort_id, cohort_fp = derive_cohort_identity(
        task="candidate_vetting",
        cohort_kind="GOLDEN_TEST",
        source_gold_snapshot_id=gold_manifest.snapshot_id,
        source_gold_manifest_sha256=manifest_sha,
        dataset_view_version=dview_version,
        dataset_view_fingerprint=dview_fp,
        selection_policy_version="candidate-golden-unseen-v1",
        excluded_group_cohort_ids=excluded_ids,
        group_keys=sorted_group_keys,
    )

    created_at = datetime.now(timezone.utc).isoformat()

    return EvaluationCohort(
        schema_version=1,
        cohort_id=cohort_id,
        cohort_fingerprint=cohort_fp,
        task="candidate_vetting",
        cohort_kind="GOLDEN_TEST",
        source_gold_snapshot_id=gold_manifest.snapshot_id,
        source_gold_manifest_sha256=manifest_sha,
        dataset_view_version=dview_version,
        dataset_view_fingerprint=dview_fp,
        selection_policy_version="candidate-golden-unseen-v1",
        excluded_group_cohort_ids=excluded_ids,
        group_count=len(sorted_group_keys),
        row_count=len(eligible_rows),
        group_keys=sorted_group_keys,
        positive_count=pos_c,
        negative_count=neg_c,
        created_at=created_at,
    )


def build_candidate_recent_cohort(
    gold_manifest: GoldSnapshotManifest,
    candidate_rows: List[Dict[str, Any]],
    training_split: Optional[Any] = None,
    golden_cohort: Optional[EvaluationCohort] = None,
    training_max_sector: Optional[int] = None,
) -> EvaluationCohort:
    """Build candidate Recent Holdout cohort for newer sectors, excluding all training and golden groups."""
    dev_groups = (
        {a.group_key for a in training_split.assignments}
        if training_split is not None
        else set()
    )
    if golden_cohort:
        dev_groups.update(golden_cohort.group_keys)

    if training_max_sector is None:
        training_max_sector = 0
        if dev_groups:
            for r in candidate_rows:
                if derive_group_key(r) in dev_groups:
                    s = r.get("sector")
                    if s is not None and isinstance(s, int):
                        training_max_sector = max(training_max_sector, s)
        if training_max_sector == 0:
            all_sectors = sorted(
                {
                    r.get("sector")
                    for r in candidate_rows
                    if r.get("sector") is not None and isinstance(r.get("sector"), int)
                }
            )
            if len(all_sectors) > 1:
                training_max_sector = all_sectors[-2]
            elif len(all_sectors) == 1:
                training_max_sector = all_sectors[0] - 1

    recent_rows = [
        r
        for r in candidate_rows
        if (r.get("sector") or 0) > training_max_sector
        and r.get("training_label") in ("POSITIVE", "NEGATIVE")
    ]

    groups: Dict[str, List[Dict[str, Any]]] = {}
    for r in recent_rows:
        gk = derive_group_key(r)
        if gk not in dev_groups:
            groups.setdefault(gk, []).append(r)

    if not groups:
        raise MlEvaluationError(
            f"NO_RECENT_GROUPS: No unseen target groups found for sector > {training_max_sector}"
        )

    sorted_group_keys = sorted(groups.keys())
    eligible_rows = [r for gk in sorted_group_keys for r in groups[gk]]

    pos_c = sum(1 for r in eligible_rows if r.get("training_label") == "POSITIVE")
    neg_c = sum(1 for r in eligible_rows if r.get("training_label") == "NEGATIVE")

    manifest_sha = hashlib.sha256(
        json.dumps(
            gold_manifest.to_dict(), sort_keys=True, separators=(",", ":")
        ).encode("utf-8")
    ).hexdigest()

    dview_version = (
        training_split.dataset_view_version
        if training_split is not None
        else "candidate-ml-view-v1"
    )
    dview_fp = (
        training_split.split_fingerprint if training_split is not None else ("0" * 64)
    )
    excluded_ids = [training_split.split_id] if training_split is not None else []
    if golden_cohort:
        excluded_ids.append(golden_cohort.cohort_id)

    cohort_id, cohort_fp = derive_cohort_identity(
        task="candidate_vetting",
        cohort_kind="RECENT_HOLDOUT",
        source_gold_snapshot_id=gold_manifest.snapshot_id,
        source_gold_manifest_sha256=manifest_sha,
        dataset_view_version=dview_version,
        dataset_view_fingerprint=dview_fp,
        selection_policy_version="candidate-recent-sector-v1",
        excluded_group_cohort_ids=excluded_ids,
        group_keys=sorted_group_keys,
    )

    created_at = datetime.now(timezone.utc).isoformat()

    return EvaluationCohort(
        schema_version=1,
        cohort_id=cohort_id,
        cohort_fingerprint=cohort_fp,
        task="candidate_vetting",
        cohort_kind="RECENT_HOLDOUT",
        source_gold_snapshot_id=gold_manifest.snapshot_id,
        source_gold_manifest_sha256=manifest_sha,
        dataset_view_version=dview_version,
        dataset_view_fingerprint=dview_fp,
        selection_policy_version="candidate-recent-sector-v1",
        excluded_group_cohort_ids=excluded_ids,
        group_count=len(sorted_group_keys),
        row_count=len(eligible_rows),
        group_keys=sorted_group_keys,
        positive_count=pos_c,
        negative_count=neg_c,
        training_max_sector=training_max_sector,
        created_at=created_at,
    )


def build_anomaly_golden_cohort(
    gold_manifest: GoldSnapshotManifest,
    anomaly_rows: List[Dict[str, Any]],
    training_split: Optional[Any] = None,
) -> EvaluationCohort:
    """Build unsupervised anomaly Golden Test cohort excluding TRAIN & VALIDATION groups."""
    dev_groups = (
        {a.group_key for a in training_split.assignments}
        if training_split is not None
        else set()
    )

    groups: Dict[str, List[Dict[str, Any]]] = {}
    for r in anomaly_rows:
        gk = derive_group_key(r)
        if gk not in dev_groups:
            groups.setdefault(gk, []).append(r)

    if not groups:
        raise MlEvaluationError(
            "NO_UNSEEN_GROUPS: No unseen target groups available for anomaly Golden Test"
        )

    sorted_group_keys = sorted(groups.keys())
    eligible_rows = [r for gk in sorted_group_keys for r in groups[gk]]

    manifest_sha = hashlib.sha256(
        json.dumps(
            gold_manifest.to_dict(), sort_keys=True, separators=(",", ":")
        ).encode("utf-8")
    ).hexdigest()

    dview_version = (
        training_split.dataset_view_version
        if training_split is not None
        else "anomaly-ml-view-v1"
    )
    dview_fp = (
        training_split.split_fingerprint if training_split is not None else ("0" * 64)
    )
    excluded_ids = [training_split.split_id] if training_split is not None else []

    cohort_id, cohort_fp = derive_cohort_identity(
        task="astronomical_anomaly_detection",
        cohort_kind="GOLDEN_TEST",
        source_gold_snapshot_id=gold_manifest.snapshot_id,
        source_gold_manifest_sha256=manifest_sha,
        dataset_view_version=dview_version,
        dataset_view_fingerprint=dview_fp,
        selection_policy_version="anomaly-golden-unseen-v1",
        excluded_group_cohort_ids=excluded_ids,
        group_keys=sorted_group_keys,
    )

    created_at = datetime.now(timezone.utc).isoformat()

    return EvaluationCohort(
        schema_version=1,
        cohort_id=cohort_id,
        cohort_fingerprint=cohort_fp,
        task="astronomical_anomaly_detection",
        cohort_kind="GOLDEN_TEST",
        source_gold_snapshot_id=gold_manifest.snapshot_id,
        source_gold_manifest_sha256=manifest_sha,
        dataset_view_version=dview_version,
        dataset_view_fingerprint=dview_fp,
        selection_policy_version="anomaly-golden-unseen-v1",
        excluded_group_cohort_ids=excluded_ids,
        group_count=len(sorted_group_keys),
        row_count=len(eligible_rows),
        group_keys=sorted_group_keys,
        created_at=created_at,
    )


def build_anomaly_recent_cohort(
    gold_manifest: GoldSnapshotManifest,
    anomaly_rows: List[Dict[str, Any]],
    training_split: Optional[Any] = None,
    golden_cohort: Optional[EvaluationCohort] = None,
    training_max_sector: Optional[int] = None,
) -> EvaluationCohort:
    """Build anomaly Recent Holdout cohort for newer sectors, excluding all training and golden groups."""
    dev_groups = (
        {a.group_key for a in training_split.assignments}
        if training_split is not None
        else set()
    )
    if golden_cohort:
        dev_groups.update(golden_cohort.group_keys)

    if training_max_sector is None:
        training_max_sector = 0
        if dev_groups:
            for r in anomaly_rows:
                if derive_group_key(r) in dev_groups:
                    s = r.get("sector")
                    if s is not None and isinstance(s, int):
                        training_max_sector = max(training_max_sector, s)
        if training_max_sector == 0:
            all_sectors = sorted(
                {
                    r.get("sector")
                    for r in anomaly_rows
                    if r.get("sector") is not None and isinstance(r.get("sector"), int)
                }
            )
            if len(all_sectors) > 1:
                training_max_sector = all_sectors[-2]
            elif len(all_sectors) == 1:
                training_max_sector = all_sectors[0] - 1

    recent_rows = [
        r for r in anomaly_rows if (r.get("sector") or 0) > training_max_sector
    ]

    groups: Dict[str, List[Dict[str, Any]]] = {}
    for r in recent_rows:
        gk = derive_group_key(r)
        if gk not in dev_groups:
            groups.setdefault(gk, []).append(r)

    if not groups:
        raise MlEvaluationError(
            f"NO_RECENT_GROUPS: No unseen anomaly target groups found for sector > {training_max_sector}"
        )

    sorted_group_keys = sorted(groups.keys())
    eligible_rows = [r for gk in sorted_group_keys for r in groups[gk]]

    manifest_sha = hashlib.sha256(
        json.dumps(
            gold_manifest.to_dict(), sort_keys=True, separators=(",", ":")
        ).encode("utf-8")
    ).hexdigest()

    dview_version = (
        training_split.dataset_view_version
        if training_split is not None
        else "anomaly-ml-view-v1"
    )
    dview_fp = (
        training_split.split_fingerprint if training_split is not None else ("0" * 64)
    )
    excluded_ids = [training_split.split_id] if training_split is not None else []
    if golden_cohort:
        excluded_ids.append(golden_cohort.cohort_id)

    cohort_id, cohort_fp = derive_cohort_identity(
        task="astronomical_anomaly_detection",
        cohort_kind="RECENT_HOLDOUT",
        source_gold_snapshot_id=gold_manifest.snapshot_id,
        source_gold_manifest_sha256=manifest_sha,
        dataset_view_version=dview_version,
        dataset_view_fingerprint=dview_fp,
        selection_policy_version="anomaly-recent-sector-v1",
        excluded_group_cohort_ids=excluded_ids,
        group_keys=sorted_group_keys,
    )

    created_at = datetime.now(timezone.utc).isoformat()

    return EvaluationCohort(
        schema_version=1,
        cohort_id=cohort_id,
        cohort_fingerprint=cohort_fp,
        task="astronomical_anomaly_detection",
        cohort_kind="RECENT_HOLDOUT",
        source_gold_snapshot_id=gold_manifest.snapshot_id,
        source_gold_manifest_sha256=manifest_sha,
        dataset_view_version=dview_version,
        dataset_view_fingerprint=dview_fp,
        selection_policy_version="anomaly-recent-sector-v1",
        excluded_group_cohort_ids=excluded_ids,
        group_count=len(sorted_group_keys),
        row_count=len(eligible_rows),
        group_keys=sorted_group_keys,
        training_max_sector=training_max_sector,
        created_at=created_at,
    )


def build_evaluation_cohort(
    task: str,
    kind: str,
    gold_manifest: Any,
    rows: List[Dict[str, Any]],
    training_split: Optional[Any] = None,
    golden_cohort: Optional[Any] = None,
) -> EvaluationCohort:
    """Convenience helper to build Golden or Recent evaluation cohort for a task."""
    if task == "candidate_vetting":
        if kind in ("GOLDEN", "GOLDEN_TEST"):
            return build_candidate_golden_cohort(gold_manifest, rows, training_split)
        return build_candidate_recent_cohort(
            gold_manifest, rows, training_split, golden_cohort
        )
    else:
        if kind in ("GOLDEN", "GOLDEN_TEST"):
            return build_anomaly_golden_cohort(gold_manifest, rows, training_split)
        return build_anomaly_recent_cohort(
            gold_manifest, rows, training_split, golden_cohort
        )


def save_evaluation_cohort(
    cohort: EvaluationCohort, dest_root: str = "evaluations/cohorts"
) -> str:
    """Save evaluation cohort manifest idempotently to evaluations/cohorts/<task>/<kind>/<cohort-id>/manifest.json."""
    task_dir = "candidate" if cohort.task == "candidate_vetting" else "anomaly"
    kind_dir = "golden" if cohort.cohort_kind == "GOLDEN_TEST" else "recent"
    cohort_dir = os.path.join(dest_root, task_dir, kind_dir, cohort.cohort_id)
    os.makedirs(cohort_dir, exist_ok=True)

    manifest_path = os.path.join(cohort_dir, "manifest.json")
    cohort_dict = cohort.to_dict()
    new_json = json.dumps(cohort_dict, indent=2, sort_keys=True)

    if os.path.exists(manifest_path):
        with open(manifest_path, "r", encoding="utf-8") as f:
            existing = json.load(f)
        if existing.get("cohort_fingerprint") != cohort.cohort_fingerprint:
            raise EvaluationCohortConflictError(
                f"EVALUATION_COHORT_CONFLICT: Existing manifest at {manifest_path} has conflicting fingerprint"
            )
        return manifest_path

    with open(manifest_path, "w", encoding="utf-8") as f:
        f.write(new_json)

    return manifest_path


def load_evaluation_cohort(manifest_path: str) -> EvaluationCohort:
    """Load EvaluationCohort from JSON manifest file."""
    if not os.path.exists(manifest_path):
        raise MlEvaluationError(
            f"Evaluation cohort manifest not found: {manifest_path}"
        )

    with open(manifest_path, "r", encoding="utf-8") as f:
        d = json.load(f)

    return EvaluationCohort(
        schema_version=d.get("schema_version", 1),
        cohort_id=d["cohort_id"],
        cohort_fingerprint=d["cohort_fingerprint"],
        task=d["task"],
        cohort_kind=d["cohort_kind"],
        source_gold_snapshot_id=d["source_gold_snapshot_id"],
        source_gold_manifest_sha256=d["source_gold_manifest_sha256"],
        dataset_view_version=d["dataset_view_version"],
        dataset_view_fingerprint=d["dataset_view_fingerprint"],
        selection_policy_version=d["selection_policy_version"],
        excluded_group_cohort_ids=d["excluded_group_cohort_ids"],
        group_count=d["group_count"],
        row_count=d["row_count"],
        group_keys=d["group_keys"],
        created_at=d["created_at"],
        positive_count=d.get("positive_count"),
        negative_count=d.get("negative_count"),
        training_max_sector=d.get("training_max_sector"),
        producer=d.get("producer", "python-ml-worker"),
    )
