"""ML Model Evaluation Engine: Golden Test & Recent Holdout (Phase 6.4).

Implements ml-evaluation-cohort-v1 and model-evaluation-v1 for Candidate Vetting
and Astronomical Anomaly Detection.
"""

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from typing import Any, Dict, List, Optional, Set, Tuple

import numpy as np
import torch

from aurora_ml.ml.anomaly.checkpoint import AnomalyTrainingRunManifest
from aurora_ml.ml.anomaly.model import (
    AnomalyLightcurveAutoencoder,
    compute_reconstruction_mse,
)
from aurora_ml.ml.anomaly.preprocessor import AnomalyPreprocessor
from aurora_ml.ml.candidate.checkpoint import TrainingRunManifest
from aurora_ml.ml.candidate.model import CandidateTabularMLP
from aurora_ml.ml.candidate.preprocessor import CandidatePreprocessor
from aurora_ml.ml.datasets.splits import (
    ANOMALY_MODEL_INPUT_FEATURES,
    CANDIDATE_MODEL_INPUT_FEATURES,
    CandidateGroupSplit,
    derive_group_key,
)
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


# -----------------------------------------------------------------------------
# 1. Evaluation Cohorts (ml-evaluation-cohort-v1)
# -----------------------------------------------------------------------------


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
        # Clean null values if not set
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
    training_split: CandidateGroupSplit,
) -> EvaluationCohort:
    """Build candidate Golden Test cohort from committed Gold snapshot, excluding TRAIN & VALIDATION groups."""
    dev_groups = {a.group_key for a in training_split.assignments}

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
        raise MlEvaluationError("NO_UNSEEN_GROUPS: No unseen target groups available for Golden Test")

    sorted_group_keys = sorted(groups.keys())
    eligible_rows = [r for gk in sorted_group_keys for r in groups[gk]]

    pos_c = sum(1 for r in eligible_rows if r.get("training_label") == "POSITIVE")
    neg_c = sum(1 for r in eligible_rows if r.get("training_label") == "NEGATIVE")

    if pos_c == 0 or neg_c == 0:
        raise InsufficientClassCoverageError(
            f"INSUFFICIENT_GOLDEN_CLASS_COVERAGE: Golden cohort requires >=1 POSITIVE ({pos_c}) and >=1 NEGATIVE ({neg_c})"
        )

    manifest_sha = hashlib.sha256(
        json.dumps(gold_manifest.to_dict(), sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()

    cohort_id, cohort_fp = derive_cohort_identity(
        task="candidate_vetting",
        cohort_kind="GOLDEN_TEST",
        source_gold_snapshot_id=gold_manifest.snapshot_id,
        source_gold_manifest_sha256=manifest_sha,
        dataset_view_version=training_split.dataset_view_version,
        dataset_view_fingerprint=training_split.split_fingerprint,
        selection_policy_version="candidate-golden-unseen-v1",
        excluded_group_cohort_ids=[training_split.split_id],
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
        dataset_view_version=training_split.dataset_view_version,
        dataset_view_fingerprint=training_split.split_fingerprint,
        selection_policy_version="candidate-golden-unseen-v1",
        excluded_group_cohort_ids=[training_split.split_id],
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
    training_split: CandidateGroupSplit,
    golden_cohort: Optional[EvaluationCohort] = None,
    training_max_sector: Optional[int] = None,
) -> EvaluationCohort:
    """Build candidate Recent Holdout cohort for newer sectors, excluding all training and golden groups."""
    dev_groups = {a.group_key for a in training_split.assignments}
    if golden_cohort:
        dev_groups.update(golden_cohort.group_keys)

    # Determine training max sector if not explicitly supplied
    if training_max_sector is None:
        # Default to highest sector in training rows
        training_max_sector = 0
        for r in candidate_rows:
            s = r.get("sector")
            if s is not None and isinstance(s, int):
                training_max_sector = max(training_max_sector, s)

    # Filter rows with sector > training_max_sector and supervised labels
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
        json.dumps(gold_manifest.to_dict(), sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()

    excluded_ids = [training_split.split_id]
    if golden_cohort:
        excluded_ids.append(golden_cohort.cohort_id)

    cohort_id, cohort_fp = derive_cohort_identity(
        task="candidate_vetting",
        cohort_kind="RECENT_HOLDOUT",
        source_gold_snapshot_id=gold_manifest.snapshot_id,
        source_gold_manifest_sha256=manifest_sha,
        dataset_view_version=training_split.dataset_view_version,
        dataset_view_fingerprint=training_split.split_fingerprint,
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
        dataset_view_version=training_split.dataset_view_version,
        dataset_view_fingerprint=training_split.split_fingerprint,
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
    training_split: CandidateGroupSplit,
) -> EvaluationCohort:
    """Build unsupervised anomaly Golden Test cohort excluding TRAIN & VALIDATION groups."""
    dev_groups = {a.group_key for a in training_split.assignments}

    groups: Dict[str, List[Dict[str, Any]]] = {}
    for r in anomaly_rows:
        gk = derive_group_key(r)
        if gk not in dev_groups:
            groups.setdefault(gk, []).append(r)

    if not groups:
        raise MlEvaluationError("NO_UNSEEN_GROUPS: No unseen target groups available for anomaly Golden Test")

    sorted_group_keys = sorted(groups.keys())
    eligible_rows = [r for gk in sorted_group_keys for r in groups[gk]]

    manifest_sha = hashlib.sha256(
        json.dumps(gold_manifest.to_dict(), sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()

    cohort_id, cohort_fp = derive_cohort_identity(
        task="astronomical_anomaly_detection",
        cohort_kind="GOLDEN_TEST",
        source_gold_snapshot_id=gold_manifest.snapshot_id,
        source_gold_manifest_sha256=manifest_sha,
        dataset_view_version=training_split.dataset_view_version,
        dataset_view_fingerprint=training_split.split_fingerprint,
        selection_policy_version="anomaly-golden-unseen-v1",
        excluded_group_cohort_ids=[training_split.split_id],
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
        dataset_view_version=training_split.dataset_view_version,
        dataset_view_fingerprint=training_split.split_fingerprint,
        selection_policy_version="anomaly-golden-unseen-v1",
        excluded_group_cohort_ids=[training_split.split_id],
        group_count=len(sorted_group_keys),
        row_count=len(eligible_rows),
        group_keys=sorted_group_keys,
        created_at=created_at,
    )


def build_anomaly_recent_cohort(
    gold_manifest: GoldSnapshotManifest,
    anomaly_rows: List[Dict[str, Any]],
    training_split: CandidateGroupSplit,
    golden_cohort: Optional[EvaluationCohort] = None,
    training_max_sector: Optional[int] = None,
) -> EvaluationCohort:
    """Build anomaly Recent Holdout cohort for newer sectors, excluding all training and golden groups."""
    dev_groups = {a.group_key for a in training_split.assignments}
    if golden_cohort:
        dev_groups.update(golden_cohort.group_keys)

    if training_max_sector is None:
        training_max_sector = 0
        for r in anomaly_rows:
            s = r.get("sector")
            if s is not None and isinstance(s, int):
                training_max_sector = max(training_max_sector, s)

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
        json.dumps(gold_manifest.to_dict(), sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()

    excluded_ids = [training_split.split_id]
    if golden_cohort:
        excluded_ids.append(golden_cohort.cohort_id)

    cohort_id, cohort_fp = derive_cohort_identity(
        task="astronomical_anomaly_detection",
        cohort_kind="RECENT_HOLDOUT",
        source_gold_snapshot_id=gold_manifest.snapshot_id,
        source_gold_manifest_sha256=manifest_sha,
        dataset_view_version=training_split.dataset_view_version,
        dataset_view_fingerprint=training_split.split_fingerprint,
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
        dataset_view_version=training_split.dataset_view_version,
        dataset_view_fingerprint=training_split.split_fingerprint,
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
        return build_candidate_recent_cohort(gold_manifest, rows, training_split, golden_cohort)
    else:
        if kind in ("GOLDEN", "GOLDEN_TEST"):
            return build_anomaly_golden_cohort(gold_manifest, rows, training_split)
        return build_anomaly_recent_cohort(gold_manifest, rows, training_split, golden_cohort)


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
        raise MlEvaluationError(f"Evaluation cohort manifest not found: {manifest_path}")

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


# -----------------------------------------------------------------------------
# 2. Candidate Evaluation Math (candidate-threshold-max-f1-v1 & metrics)
# -----------------------------------------------------------------------------


def select_candidate_validation_threshold(
    y_true: np.ndarray, y_prob: np.ndarray
) -> Tuple[float, float, float, float]:
    """Select decision threshold strictly on VALIDATION set using candidate-threshold-max-f1-v1.

    Tie-breaking semantics:
    1. Maximum F1 score
    2. Higher recall (favors sensitivity)
    3. Higher precision
    4. Lower threshold value
    """
    y_true_flat = y_true.flatten().astype(int)
    y_prob_flat = y_prob.flatten().astype(float)

    unique_probs = np.unique(y_prob_flat)
    candidate_thresholds = np.sort(unique_probs)

    best_thresh = 0.5
    best_f1 = -1.0
    best_rec = -1.0
    best_prec = -1.0

    for t in candidate_thresholds:
        preds = (y_prob_flat >= t).astype(int)
        tp = int(np.sum((preds == 1) & (y_true_flat == 1)))
        fp = int(np.sum((preds == 1) & (y_true_flat == 0)))
        fn = int(np.sum((preds == 0) & (y_true_flat == 1)))

        prec = float(tp / (tp + fp)) if (tp + fp) > 0 else 0.0
        rec = float(tp / (tp + fn)) if (tp + fn) > 0 else 0.0
        f1 = float(2 * prec * rec / (prec + rec)) if (prec + rec) > 0 else 0.0

        # Max F1 with tie-breaks: 1. Higher F1, 2. Higher Recall, 3. Higher Precision, 4. Lower Threshold
        if f1 > best_f1:
            best_f1, best_rec, best_prec, best_thresh = f1, rec, prec, float(t)
        elif abs(f1 - best_f1) < 1e-9:
            if rec > best_rec:
                best_f1, best_rec, best_prec, best_thresh = f1, rec, prec, float(t)
            elif abs(rec - best_rec) < 1e-9:
                if prec > best_prec:
                    best_f1, best_rec, best_prec, best_thresh = f1, rec, prec, float(t)
                elif abs(prec - best_prec) < 1e-9:
                    if t < best_thresh:
                        best_f1, best_rec, best_prec, best_thresh = f1, rec, prec, float(t)

    return best_thresh, best_f1, best_prec, best_rec


def compute_average_precision(y_true: np.ndarray, y_prob: np.ndarray) -> float:
    """Compute Average Precision (PR-AUC) from continuous predicted probabilities."""
    y_true_flat = y_true.flatten().astype(int)
    y_prob_flat = y_prob.flatten().astype(float)

    order = np.argsort(-y_prob_flat)
    y_true_sorted = y_true_flat[order]
    y_prob_sorted = y_prob_flat[order]

    n_pos = np.sum(y_true_flat == 1)
    if n_pos == 0:
        return 0.0

    tp_cumulative = np.cumsum(y_true_sorted == 1)
    fp_cumulative = np.cumsum(y_true_sorted == 0)

    precisions = tp_cumulative / (tp_cumulative + fp_cumulative)
    recalls = tp_cumulative / n_pos

    # Calculate trapezoidal / step area for AP
    recalls_with_zero = np.insert(recalls, 0, 0.0)
    precisions_with_zero = np.insert(precisions, 0, precisions[0] if len(precisions) > 0 else 1.0)
    recall_diffs = np.diff(recalls_with_zero)

    ap = float(np.sum(precisions * (y_true_sorted == 1)) / n_pos)
    return max(0.0, min(1.0, ap))


def compute_roc_auc(y_true: np.ndarray, y_prob: np.ndarray) -> float:
    """Compute ROC-AUC from continuous probabilities via trapezoidal integration."""
    y_true_flat = y_true.flatten().astype(int)
    y_prob_flat = y_prob.flatten().astype(float)

    n_pos = np.sum(y_true_flat == 1)
    n_neg = np.sum(y_true_flat == 0)

    if n_pos == 0 or n_neg == 0:
        return 0.5

    # Sort descending
    order = np.argsort(-y_prob_flat)
    y_true_sorted = y_true_flat[order]

    tp_cumulative = np.cumsum(y_true_sorted == 1)
    fp_cumulative = np.cumsum(y_true_sorted == 0)

    tpr = tp_cumulative / n_pos
    fpr = fp_cumulative / n_neg

    tpr = np.insert(tpr, 0, 0.0)
    fpr = np.insert(fpr, 0, 0.0)

    # Trapezoid integration compatible with both NumPy 1.x and 2.x
    auc = float(0.5 * np.sum((tpr[1:] + tpr[:-1]) * np.diff(fpr)))
    return max(0.0, min(1.0, auc))


def calculate_candidate_cohort_metrics(
    y_true: np.ndarray, y_prob: np.ndarray, threshold: float
) -> Dict[str, Any]:
    """Calculate comprehensive evaluation metrics on a candidate cohort."""
    y_true_flat = y_true.flatten().astype(int)
    y_prob_flat = y_prob.flatten().astype(float)

    n_pos = int(np.sum(y_true_flat == 1))
    n_neg = int(np.sum(y_true_flat == 0))

    if n_pos == 0 or n_neg == 0:
        return {
            "status": "INSUFFICIENT_CLASS_COVERAGE",
            "row_count": len(y_true_flat),
            "positive_count": n_pos,
            "negative_count": n_neg,
        }

    pr_auc = compute_average_precision(y_true_flat, y_prob_flat)
    roc_auc = compute_roc_auc(y_true_flat, y_prob_flat)

    preds = (y_prob_flat >= threshold).astype(int)
    tp = int(np.sum((preds == 1) & (y_true_flat == 1)))
    fp = int(np.sum((preds == 1) & (y_true_flat == 0)))
    tn = int(np.sum((preds == 0) & (y_true_flat == 0)))
    fn = int(np.sum((preds == 0) & (y_true_flat == 1)))

    precision = float(tp / (tp + fp)) if (tp + fp) > 0 else 0.0
    recall = float(tp / (tp + fn)) if (tp + fn) > 0 else 0.0
    f1 = float(2 * precision * recall / (precision + recall)) if (precision + recall) > 0 else 0.0

    return {
        "status": "OK",
        "row_count": len(y_true_flat),
        "positive_count": n_pos,
        "negative_count": n_neg,
        "pr_auc": pr_auc,
        "roc_auc": roc_auc,
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "confusion_matrix": [[tn, fp], [fn, tp]],  # [[TN, FP], [FN, TP]]
    }


# -----------------------------------------------------------------------------
# 3. Anomaly Evaluation Math (anomaly-threshold-validation-p99-v1 & synthetic shift)
# -----------------------------------------------------------------------------


def select_anomaly_validation_threshold(val_scores: np.ndarray) -> float:
    """Select decision threshold strictly on VALIDATION reconstruction scores using anomaly-threshold-validation-p99-v1."""
    if len(val_scores) == 0:
        raise MlEvaluationError("NO_VALIDATION_SCORES: Cannot compute threshold on empty validation scores")

    threshold = float(np.quantile(val_scores, 0.99, method="linear"))
    return threshold


def apply_synthetic_standardized_shift(
    X_std: np.ndarray, source_product_ids: List[str]
) -> np.ndarray:
    """Apply deterministic +6 sigma standardized shift per anomaly-synthetic-standardized-shift-v1.

    For each row i:
    feature_idx = uint64(sha256(source_product_id)[:8]) % input_dim
    X_synthetic[i, feature_idx] += 6.0
    """
    X_synthetic = X_std.copy()
    input_dim = X_std.shape[1]

    for i, pid in enumerate(source_product_ids):
        digest = hashlib.sha256(str(pid).encode("utf-8")).hexdigest()
        feature_idx = int(digest[:16], 16) % input_dim
        X_synthetic[i, feature_idx] += 6.0

    return X_synthetic


def calculate_anomaly_score_distribution(scores: np.ndarray) -> Dict[str, float]:
    """Calculate statistical distribution of continuous anomaly scores."""
    s = scores.flatten().astype(float)
    if len(s) == 0:
        return {
            "mean": 0.0,
            "median": 0.0,
            "p95": 0.0,
            "p99": 0.0,
            "max": 0.0,
        }

    return {
        "mean": float(np.mean(s)),
        "median": float(np.median(s)),
        "p95": float(np.quantile(s, 0.95, method="linear")),
        "p99": float(np.quantile(s, 0.99, method="linear")),
        "max": float(np.max(s)),
    }


# -----------------------------------------------------------------------------
# 4. Evaluation Runs (model-evaluation-v1)
# -----------------------------------------------------------------------------


@dataclass(frozen=True)
class EvaluationRunManifest:
    """Immutable evaluation run manifest conforming to model-evaluation-v1."""

    schema_version: int
    evaluation_run_id: str
    evaluation_spec_fingerprint: str
    task: str
    training_run_id: str
    training_run_manifest_sha256: str
    model_version: str
    model_sha256: str
    preprocessing_version: str
    preprocessing_sha256: str
    golden_cohort_id: str
    golden_cohort_manifest_sha256: str
    evaluation_policy_version: str
    threshold_policy_version: str
    decision_threshold: float
    threshold_sha256: str
    metrics_sha256: str
    metrics: Dict[str, Any]
    created_at: str
    producer: str = "python-ml-worker"
    recent_cohort_id: Optional[str] = None
    recent_cohort_manifest_sha256: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        return {k: v for k, v in d.items() if v is not None}


def derive_evaluation_run_identity(
    task: str,
    training_run_id: str,
    training_run_manifest_sha256: str,
    model_sha256: str,
    preprocessing_sha256: str,
    golden_cohort_id: str,
    golden_cohort_manifest_sha256: str,
    recent_cohort_id: Optional[str],
    recent_cohort_manifest_sha256: Optional[str],
    evaluation_policy_version: str,
    threshold_policy_version: str,
) -> Tuple[str, str]:
    """Derive deterministic evaluation spec fingerprint and evaluation run ID."""
    canonical_obj = {
        "evaluation_policy_version": evaluation_policy_version,
        "golden_cohort_id": golden_cohort_id,
        "golden_cohort_manifest_sha256": golden_cohort_manifest_sha256,
        "model_sha256": model_sha256,
        "preprocessing_sha256": preprocessing_sha256,
        "recent_cohort_id": recent_cohort_id,
        "recent_cohort_manifest_sha256": recent_cohort_manifest_sha256,
        "task": task,
        "threshold_policy_version": threshold_policy_version,
        "training_run_id": training_run_id,
        "training_run_manifest_sha256": training_run_manifest_sha256,
    }
    canonical_json = json.dumps(canonical_obj, sort_keys=True, separators=(",", ":"))
    eval_fp = hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()

    prefix = "cand" if task == "candidate_vetting" else "anom"
    eval_run_id = f"eval-{prefix}-v1-{eval_fp[:12]}"

    return eval_run_id, eval_fp


# -----------------------------------------------------------------------------
# 5. Full Evaluation Orchestrators
# -----------------------------------------------------------------------------


def evaluate_candidate_model(
    training_manifest: TrainingRunManifest,
    training_split: CandidateGroupSplit,
    golden_cohort: EvaluationCohort,
    training_rows: List[Dict[str, Any]],
    golden_rows: List[Dict[str, Any]],
    model_state_dict: Dict[str, Any],
    preprocessor_json_path: str,
    recent_cohort: Optional[EvaluationCohort] = None,
    recent_rows: Optional[List[Dict[str, Any]]] = None,
    dest_dir: Optional[str] = None,
) -> Tuple[EvaluationRunManifest, Dict[str, Any], Dict[str, Any]]:
    """Execute complete candidate model evaluation against frozen Golden Test and Recent Holdout cohorts."""
    # 1. Preflight contamination checks
    check_group_contamination(
        cohort_group_keys=golden_cohort.group_keys,
        training_split=training_split,
    )
    if recent_cohort:
        check_group_contamination(
            cohort_group_keys=recent_cohort.group_keys,
            training_split=training_split,
            other_cohort_group_keys=golden_cohort.group_keys,
        )

    # 2. Load preprocessor and model
    preprocessor = CandidatePreprocessor.from_json_file(preprocessor_json_path)

    # Initialize PyTorch MLP
    model = CandidateTabularMLP(input_dim=len(CANDIDATE_MODEL_INPUT_FEATURES))
    model.load_state_dict(model_state_dict)
    model.eval()

    # 3. Reconstruct VALIDATION rows strictly to determine decision threshold
    val_groups = {
        a.group_key for a in training_split.assignments if a.split == "VALIDATION"
    }
    val_candidate_rows = [
        r
        for r in training_rows
        if derive_group_key(r) in val_groups
        and r.get("training_label") in ("POSITIVE", "NEGATIVE")
    ]

    val_tensors, val_labels = preprocessor.transform(val_candidate_rows)

    with torch.no_grad():
        val_logits = model(val_tensors)
        val_probs = torch.sigmoid(val_logits).numpy().flatten()

    # 4. Select threshold on VALIDATION only
    decision_threshold, val_f1, val_prec, val_rec = select_candidate_validation_threshold(
        y_true=val_labels.numpy(), y_prob=val_probs
    )

    # 5. Evaluate Golden Test cohort
    golden_group_set = set(golden_cohort.group_keys)
    golden_eval_rows = [
        r
        for r in golden_rows
        if derive_group_key(r) in golden_group_set
        and r.get("training_label") in ("POSITIVE", "NEGATIVE")
    ]

    golden_tensors, golden_labels = preprocessor.transform(golden_eval_rows)

    with torch.no_grad():
        golden_logits = model(golden_tensors)
        golden_probs = torch.sigmoid(golden_logits).numpy().flatten()

    golden_metrics = calculate_candidate_cohort_metrics(
        y_true=golden_labels.numpy(),
        y_prob=golden_probs,
        threshold=decision_threshold,
    )

    # 6. Evaluate Recent Holdout cohort if provided
    recent_metrics: Optional[Dict[str, Any]] = None
    if recent_cohort and recent_rows:
        recent_group_set = set(recent_cohort.group_keys)
        recent_eval_rows = [
            r
            for r in recent_rows
            if derive_group_key(r) in recent_group_set
            and r.get("training_label") in ("POSITIVE", "NEGATIVE")
        ]
        if recent_eval_rows:
            recent_tensors, recent_labels = preprocessor.transform(recent_eval_rows)
            with torch.no_grad():
                recent_logits = model(recent_tensors)
                recent_probs = torch.sigmoid(recent_logits).numpy().flatten()

            recent_metrics = calculate_candidate_cohort_metrics(
                y_true=recent_labels.numpy(),
                y_prob=recent_probs,
                threshold=decision_threshold,
            )

    # 7. Construct threshold.json and metrics.json
    threshold_data = {
        "schema_version": 1,
        "task": "candidate_vetting",
        "threshold_policy_version": "candidate-threshold-max-f1-v1",
        "decision_threshold": decision_threshold,
        "selection_source": "VALIDATION",
        "validation_row_count": len(val_candidate_rows),
        "validation_f1": val_f1,
        "validation_precision": val_prec,
        "validation_recall": val_rec,
    }
    threshold_json = json.dumps(threshold_data, indent=2, sort_keys=True)
    threshold_sha = hashlib.sha256(threshold_json.encode("utf-8")).hexdigest()

    metrics_data: Dict[str, Any] = {
        "golden_pr_auc": golden_metrics.get("pr_auc"),
        "golden_roc_auc": golden_metrics.get("roc_auc"),
        "golden_precision": golden_metrics.get("precision"),
        "golden_recall": golden_metrics.get("recall"),
        "golden_f1": golden_metrics.get("f1"),
        "golden_confusion_matrix": golden_metrics.get("confusion_matrix"),
        "golden_row_count": golden_metrics.get("row_count"),
        "golden_positive_count": golden_metrics.get("positive_count"),
        "golden_negative_count": golden_metrics.get("negative_count"),
    }

    if recent_metrics and recent_metrics.get("status") == "OK":
        metrics_data["recent_pr_auc"] = recent_metrics.get("pr_auc")
        metrics_data["recent_roc_auc"] = recent_metrics.get("roc_auc")
        metrics_data["recent_precision"] = recent_metrics.get("precision")
        metrics_data["recent_recall"] = recent_metrics.get("recall")
        metrics_data["recent_f1"] = recent_metrics.get("f1")
        metrics_data["recent_confusion_matrix"] = recent_metrics.get("confusion_matrix")
        metrics_data["recent_row_count"] = recent_metrics.get("row_count")
        metrics_data["recent_positive_count"] = recent_metrics.get("positive_count")
        metrics_data["recent_negative_count"] = recent_metrics.get("negative_count")

        # Metric deltas
        if metrics_data.get("golden_pr_auc") is not None and metrics_data.get("recent_pr_auc") is not None:
            metrics_data["pr_auc_drift"] = float(
                metrics_data["recent_pr_auc"] - metrics_data["golden_pr_auc"]
            )
        if metrics_data.get("golden_recall") is not None and metrics_data.get("recent_recall") is not None:
            metrics_data["recall_drift"] = float(
                metrics_data["recent_recall"] - metrics_data["golden_recall"]
            )
    elif recent_metrics:
        metrics_data["recent_status"] = recent_metrics.get("status")

    metrics_json = json.dumps(metrics_data, indent=2, sort_keys=True)
    metrics_sha = hashlib.sha256(metrics_json.encode("utf-8")).hexdigest()

    # 8. Derive evaluation run identity
    training_manifest_sha = hashlib.sha256(
        json.dumps(training_manifest.to_dict(), sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    golden_cohort_sha = golden_cohort.cohort_fingerprint
    recent_cohort_sha = recent_cohort.cohort_fingerprint if recent_cohort else None

    eval_run_id, eval_spec_fp = derive_evaluation_run_identity(
        task="candidate_vetting",
        training_run_id=training_manifest.training_run_id,
        training_run_manifest_sha256=training_manifest_sha,
        model_sha256=training_manifest.model_sha256,
        preprocessing_sha256=training_manifest.preprocessing_sha256,
        golden_cohort_id=golden_cohort.cohort_id,
        golden_cohort_manifest_sha256=golden_cohort_sha,
        recent_cohort_id=recent_cohort.cohort_id if recent_cohort else None,
        recent_cohort_manifest_sha256=recent_cohort_sha,
        evaluation_policy_version="candidate-evaluation-v1",
        threshold_policy_version="candidate-threshold-max-f1-v1",
    )

    created_at = datetime.now(timezone.utc).isoformat()

    manifest = EvaluationRunManifest(
        schema_version=1,
        evaluation_run_id=eval_run_id,
        evaluation_spec_fingerprint=eval_spec_fp,
        task="candidate_vetting",
        training_run_id=training_manifest.training_run_id,
        training_run_manifest_sha256=training_manifest_sha,
        model_version=training_manifest.model_version,
        model_sha256=training_manifest.model_sha256,
        preprocessing_version=training_manifest.preprocessing_version,
        preprocessing_sha256=training_manifest.preprocessing_sha256,
        golden_cohort_id=golden_cohort.cohort_id,
        golden_cohort_manifest_sha256=golden_cohort_sha,
        recent_cohort_id=recent_cohort.cohort_id if recent_cohort else None,
        recent_cohort_manifest_sha256=recent_cohort_sha,
        evaluation_policy_version="candidate-evaluation-v1",
        threshold_policy_version="candidate-threshold-max-f1-v1",
        decision_threshold=decision_threshold,
        threshold_sha256=threshold_sha,
        metrics_sha256=metrics_sha,
        metrics=metrics_data,
        created_at=created_at,
    )

    # 9. Persist artifacts if dest_dir given
    if dest_dir:
        run_dir = os.path.join(dest_dir, eval_run_id)
        os.makedirs(run_dir, exist_ok=True)

        with open(os.path.join(run_dir, "threshold.json"), "w", encoding="utf-8") as f:
            f.write(threshold_json)
        with open(os.path.join(run_dir, "metrics.json"), "w", encoding="utf-8") as f:
            f.write(metrics_json)
        with open(os.path.join(run_dir, "manifest.json"), "w", encoding="utf-8") as f:
            json.dump(manifest.to_dict(), f, indent=2, sort_keys=True)

    return manifest, threshold_data, metrics_data


def evaluate_anomaly_model(
    training_manifest: AnomalyTrainingRunManifest,
    training_split: CandidateGroupSplit,
    golden_cohort: EvaluationCohort,
    training_rows: List[Dict[str, Any]],
    golden_rows: List[Dict[str, Any]],
    model_state_dict: Dict[str, Any],
    preprocessor_json_path: str,
    recent_cohort: Optional[EvaluationCohort] = None,
    recent_rows: Optional[List[Dict[str, Any]]] = None,
    dest_dir: Optional[str] = None,
) -> Tuple[EvaluationRunManifest, Dict[str, Any], Dict[str, Any]]:
    """Execute complete anomaly autoencoder evaluation against frozen Golden Test and Recent Holdout cohorts."""
    # 1. Preflight contamination checks
    check_group_contamination(
        cohort_group_keys=golden_cohort.group_keys,
        training_split=training_split,
    )
    if recent_cohort:
        check_group_contamination(
            cohort_group_keys=recent_cohort.group_keys,
            training_split=training_split,
            other_cohort_group_keys=golden_cohort.group_keys,
        )

    # 2. Load preprocessor and model
    preprocessor = AnomalyPreprocessor.from_json_file(preprocessor_json_path)

    model = AnomalyLightcurveAutoencoder(input_dim=len(ANOMALY_MODEL_INPUT_FEATURES))
    model.load_state_dict(model_state_dict)
    model.eval()

    # 3. Compute VALIDATION scores strictly to determine p99 threshold
    val_groups = {
        a.group_key for a in training_split.assignments if a.split == "VALIDATION"
    }
    val_anomaly_rows = [
        r for r in training_rows if derive_group_key(r) in val_groups
    ]

    val_tensors = preprocessor.transform(val_anomaly_rows)

    with torch.no_grad():
        val_reconstructed = model(val_tensors)
        val_scores = compute_reconstruction_mse(val_tensors, val_reconstructed).numpy()

    # 4. Select p99 threshold on VALIDATION only
    decision_threshold = select_anomaly_validation_threshold(val_scores)

    # 5. Evaluate Golden Test reference scores
    golden_group_set = set(golden_cohort.group_keys)
    golden_eval_rows = [
        r for r in golden_rows if derive_group_key(r) in golden_group_set
    ]
    golden_pids = [str(r.get("source_product_id")) for r in golden_eval_rows]

    golden_tensors = preprocessor.transform(golden_eval_rows)

    with torch.no_grad():
        golden_reconstructed = model(golden_tensors)
        golden_ref_scores = compute_reconstruction_mse(golden_tensors, golden_reconstructed).numpy()

    golden_ref_dist = calculate_anomaly_score_distribution(golden_ref_scores)
    golden_ref_alert_rate = float(np.mean(golden_ref_scores >= decision_threshold))

    # 6. Evaluate Golden Test synthetic perturbation
    golden_synth_tensors = torch.tensor(
        apply_synthetic_standardized_shift(
            X_std=golden_tensors.numpy(), source_product_ids=golden_pids
        ),
        dtype=torch.float32,
    )

    with torch.no_grad():
        golden_synth_recon = model(golden_synth_tensors)
        golden_synth_scores = compute_reconstruction_mse(golden_synth_tensors, golden_synth_recon).numpy()

    golden_synth_dist = calculate_anomaly_score_distribution(golden_synth_scores)
    golden_synth_detection_rate = float(np.mean(golden_synth_scores >= decision_threshold))

    # 7. Evaluate Recent Holdout if provided
    recent_metrics: Optional[Dict[str, Any]] = None
    if recent_cohort and recent_rows:
        recent_group_set = set(recent_cohort.group_keys)
        recent_eval_rows = [
            r for r in recent_rows if derive_group_key(r) in recent_group_set
        ]
        if recent_eval_rows:
            recent_pids = [str(r.get("source_product_id")) for r in recent_eval_rows]
            recent_tensors = preprocessor.transform(recent_eval_rows)

            with torch.no_grad():
                recent_reconstructed = model(recent_tensors)
                recent_ref_scores = compute_reconstruction_mse(recent_tensors, recent_reconstructed).numpy()

            recent_ref_dist = calculate_anomaly_score_distribution(recent_ref_scores)
            recent_ref_alert_rate = float(np.mean(recent_ref_scores >= decision_threshold))

            recent_synth_tensors = torch.tensor(
                apply_synthetic_standardized_shift(
                    X_std=recent_tensors.numpy(), source_product_ids=recent_pids
                ),
                dtype=torch.float32,
            )

            with torch.no_grad():
                recent_synth_recon = model(recent_synth_tensors)
                recent_synth_scores = compute_reconstruction_mse(recent_synth_tensors, recent_synth_recon).numpy()

            recent_synth_dist = calculate_anomaly_score_distribution(recent_synth_scores)
            recent_synth_detection_rate = float(np.mean(recent_synth_scores >= decision_threshold))

            recent_metrics = {
                "recent_reference_alert_rate": recent_ref_alert_rate,
                "recent_synthetic_detection_rate": recent_synth_detection_rate,
                "recent_score_mean": recent_ref_dist["mean"],
                "recent_score_median": recent_ref_dist["median"],
                "recent_score_p95": recent_ref_dist["p95"],
                "recent_score_p99": recent_ref_dist["p99"],
                "recent_score_max": recent_ref_dist["max"],
                "recent_row_count": len(recent_eval_rows),
            }

    # 8. Construct threshold.json and metrics.json
    threshold_data = {
        "schema_version": 1,
        "task": "astronomical_anomaly_detection",
        "threshold_policy_version": "anomaly-threshold-validation-p99-v1",
        "decision_threshold": decision_threshold,
        "quantile": 0.99,
        "quantile_method": "linear",
        "selection_source": "VALIDATION",
        "validation_score_count": len(val_anomaly_rows),
        "score_definition_version": "reconstruction-mse-v1",
    }
    threshold_json = json.dumps(threshold_data, indent=2, sort_keys=True)
    threshold_sha = hashlib.sha256(threshold_json.encode("utf-8")).hexdigest()

    metrics_data: Dict[str, Any] = {
        "golden_reference_alert_rate": golden_ref_alert_rate,
        "golden_score_mean": golden_ref_dist["mean"],
        "golden_score_median": golden_ref_dist["median"],
        "golden_score_p95": golden_ref_dist["p95"],
        "golden_score_p99": golden_ref_dist["p99"],
        "golden_score_max": golden_ref_dist["max"],
        "golden_synthetic_detection_rate": golden_synth_detection_rate,
        "golden_synthetic_score_mean": golden_synth_dist["mean"],
        "golden_synthetic_score_median": golden_synth_dist["median"],
        "golden_synthetic_score_p95": golden_synth_dist["p95"],
        "synthetic_score_separation": float(
            golden_synth_dist["median"] - golden_ref_dist["median"]
        ),
        "golden_row_count": len(golden_eval_rows),
    }

    if recent_metrics:
        metrics_data.update(recent_metrics)
        metrics_data["alert_rate_drift"] = float(
            recent_metrics["recent_reference_alert_rate"] - golden_ref_alert_rate
        )

    metrics_json = json.dumps(metrics_data, indent=2, sort_keys=True)
    metrics_sha = hashlib.sha256(metrics_json.encode("utf-8")).hexdigest()

    # 9. Derive evaluation run identity
    training_manifest_sha = hashlib.sha256(
        json.dumps(training_manifest.to_dict(), sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    golden_cohort_sha = golden_cohort.cohort_fingerprint
    recent_cohort_sha = recent_cohort.cohort_fingerprint if recent_cohort else None

    eval_run_id, eval_spec_fp = derive_evaluation_run_identity(
        task="astronomical_anomaly_detection",
        training_run_id=training_manifest.training_run_id,
        training_run_manifest_sha256=training_manifest_sha,
        model_sha256=training_manifest.model_sha256,
        preprocessing_sha256=training_manifest.preprocessing_sha256,
        golden_cohort_id=golden_cohort.cohort_id,
        golden_cohort_manifest_sha256=golden_cohort_sha,
        recent_cohort_id=recent_cohort.cohort_id if recent_cohort else None,
        recent_cohort_manifest_sha256=recent_cohort_sha,
        evaluation_policy_version="anomaly-evaluation-v1",
        threshold_policy_version="anomaly-threshold-validation-p99-v1",
    )

    created_at = datetime.now(timezone.utc).isoformat()

    manifest = EvaluationRunManifest(
        schema_version=1,
        evaluation_run_id=eval_run_id,
        evaluation_spec_fingerprint=eval_spec_fp,
        task="astronomical_anomaly_detection",
        training_run_id=training_manifest.training_run_id,
        training_run_manifest_sha256=training_manifest_sha,
        model_version=training_manifest.model_version,
        model_sha256=training_manifest.model_sha256,
        preprocessing_version=training_manifest.preprocessing_version,
        preprocessing_sha256=training_manifest.preprocessing_sha256,
        golden_cohort_id=golden_cohort.cohort_id,
        golden_cohort_manifest_sha256=golden_cohort_sha,
        recent_cohort_id=recent_cohort.cohort_id if recent_cohort else None,
        recent_cohort_manifest_sha256=recent_cohort_sha,
        evaluation_policy_version="anomaly-evaluation-v1",
        threshold_policy_version="anomaly-threshold-validation-p99-v1",
        decision_threshold=decision_threshold,
        threshold_sha256=threshold_sha,
        metrics_sha256=metrics_sha,
        metrics=metrics_data,
        created_at=created_at,
    )

    # 10. Persist artifacts if dest_dir given
    if dest_dir:
        run_dir = os.path.join(dest_dir, eval_run_id)
        os.makedirs(run_dir, exist_ok=True)

        with open(os.path.join(run_dir, "threshold.json"), "w", encoding="utf-8") as f:
            f.write(threshold_json)
        with open(os.path.join(run_dir, "metrics.json"), "w", encoding="utf-8") as f:
            f.write(metrics_json)
        with open(os.path.join(run_dir, "manifest.json"), "w", encoding="utf-8") as f:
            json.dump(manifest.to_dict(), f, indent=2, sort_keys=True)

    return manifest, threshold_data, metrics_data
