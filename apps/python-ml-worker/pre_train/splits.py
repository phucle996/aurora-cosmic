"""Group-Safe Dataset Splitting & Split Manifests (Pre-training Stage 1)."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import hashlib
import json
import os
from typing import Any, Dict, List, Tuple

from pre_train.view import AnomalyMlView, CandidateMlView, MlDatasetError


class MlSplitError(Exception):
    """Raised when group split construction fails."""

    pass


class MlSplitConflictError(MlSplitError):
    """Raised when an immutable split manifest conflict is detected."""

    pass


@dataclass(frozen=True)
class GroupAssignmentRecord:
    """Group assignment record within split manifest."""

    group_key: str
    split: str
    row_count: int
    positive_count: int
    negative_count: int

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class CandidateGroupSplit:
    """Immutable group-safe dataset split conforming to ml-split-v1.md."""

    split_id: str
    split_fingerprint: str
    gold_snapshot_id: str
    gold_manifest_sha256: str
    dataset_view_version: str
    split_policy_version: str
    split_seed: int
    eligible_row_count: int
    eligible_group_count: int
    train_group_count: int
    validation_group_count: int
    train_row_count: int
    validation_row_count: int
    train_positive_count: int
    train_negative_count: int
    val_positive_count: int
    val_negative_count: int
    feature_names: Tuple[str, ...]
    assignments: List[GroupAssignmentRecord]
    created_at: str
    schema_version: int = 1

    def to_dict(self) -> Dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "split_id": self.split_id,
            "split_fingerprint": self.split_fingerprint,
            "gold_snapshot_id": self.gold_snapshot_id,
            "gold_manifest_sha256": self.gold_manifest_sha256,
            "dataset_view_version": self.dataset_view_version,
            "split_policy_version": self.split_policy_version,
            "split_seed": self.split_seed,
            "eligible_row_count": self.eligible_row_count,
            "eligible_group_count": self.eligible_group_count,
            "train_group_count": self.train_group_count,
            "validation_group_count": self.validation_group_count,
            "train_row_count": self.train_row_count,
            "validation_row_count": self.validation_row_count,
            "train_positive_count": self.train_positive_count,
            "train_negative_count": self.train_negative_count,
            "val_positive_count": self.val_positive_count,
            "val_negative_count": self.val_negative_count,
            "feature_names": list(self.feature_names),
            "assignments": [a.to_dict() for a in self.assignments],
            "created_at": self.created_at,
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "CandidateGroupSplit":
        """Load and validate an immutable split manifest from JSON data."""
        assignments = [
            GroupAssignmentRecord(**assignment)
            for assignment in d.get("assignments", [])
        ]
        return cls(
            schema_version=d.get("schema_version", 1),
            split_id=d["split_id"],
            split_fingerprint=d["split_fingerprint"],
            gold_snapshot_id=d["gold_snapshot_id"],
            gold_manifest_sha256=d["gold_manifest_sha256"],
            dataset_view_version=d["dataset_view_version"],
            split_policy_version=d["split_policy_version"],
            split_seed=d["split_seed"],
            eligible_row_count=d["eligible_row_count"],
            eligible_group_count=d["eligible_group_count"],
            train_group_count=d["train_group_count"],
            validation_group_count=d["validation_group_count"],
            train_row_count=d["train_row_count"],
            validation_row_count=d["validation_row_count"],
            train_positive_count=d["train_positive_count"],
            train_negative_count=d["train_negative_count"],
            val_positive_count=d["val_positive_count"],
            val_negative_count=d["val_negative_count"],
            feature_names=tuple(d["feature_names"]),
            assignments=assignments,
            created_at=d.get("created_at", ""),
        )

    @classmethod
    def from_json(cls, json_str: str) -> "CandidateGroupSplit":
        return cls.from_dict(json.loads(json_str))


def derive_group_key(row: Dict[str, Any]) -> str:
    """Derive group key for astronomical target grouping (TIC ID if available else source_product_id)."""
    tic_id = row.get("tic_id")
    if tic_id is not None and str(tic_id).isdigit():
        return f"tic:{tic_id}"
    pid = row.get("source_product_id", "unknown")
    return f"source:{pid}"


def create_deterministic_group_split(
    view: CandidateMlView,
    seed: int = 42,
    split_policy_version: str = "candidate-group-split-v1",
    train_ratio: float = 0.8,
) -> CandidateGroupSplit:
    """Create group-safe deterministic split assigning all rows of same target to same split."""
    # Filter supervised eligible rows only (POSITIVE and NEGATIVE)
    eligible_rows = [
        r for r in view.rows if r.get("training_label") in ("POSITIVE", "NEGATIVE")
    ]

    if not eligible_rows:
        raise MlDatasetError(
            "NO_SUPERVISED_ROWS: No POSITIVE or NEGATIVE candidate rows found"
        )

    pos_rows = [r for r in eligible_rows if r.get("training_label") == "POSITIVE"]
    neg_rows = [r for r in eligible_rows if r.get("training_label") == "NEGATIVE"]

    if not pos_rows or not neg_rows:
        raise MlDatasetError(
            "SINGLE_CLASS_DATASET: Supervised dataset must contain both POSITIVE and NEGATIVE rows"
        )

    # Group rows by astronomical target identity
    groups: Dict[str, List[Dict[str, Any]]] = {}
    for r in eligible_rows:
        gk = derive_group_key(r)
        groups.setdefault(gk, []).append(r)

    if len(groups) < 2:
        raise MlDatasetError(
            "INSUFFICIENT_GROUPS: Supervised dataset requires at least 2 distinct target groups"
        )

    # Deterministic SHA-256 ranking
    sorted_group_keys = sorted(groups.keys())
    assignments: List[GroupAssignmentRecord] = []

    group_hashes = {
        gk: hashlib.sha256(
            f"{split_policy_version}:{seed}:{gk}".encode("utf-8")
        ).hexdigest()
        for gk in sorted_group_keys
    }
    ranked_group_keys = sorted(sorted_group_keys, key=lambda gk: group_hashes[gk])
    train_group_count = min(
        max(int(len(ranked_group_keys) * train_ratio), 1), len(ranked_group_keys) - 1
    )
    train_keys = set(ranked_group_keys[:train_group_count])

    def class_counts(keys: set[str]) -> tuple[int, int]:
        return (
            sum(
                1
                for gk in keys
                for r in groups[gk]
                if r.get("training_label") == "POSITIVE"
            ),
            sum(
                1
                for gk in keys
                for r in groups[gk]
                if r.get("training_label") == "NEGATIVE"
            ),
        )

    validation_keys = set(ranked_group_keys) - train_keys
    train_pos, train_neg = class_counts(train_keys)
    val_pos, val_neg = class_counts(validation_keys)
    if train_pos == 0 or train_neg == 0 or val_pos == 0 or val_neg == 0:
        for train_key in sorted(train_keys):
            for validation_key in sorted(validation_keys):
                candidate_train = (train_keys - {train_key}) | {validation_key}
                candidate_validation = set(ranked_group_keys) - candidate_train
                candidate_counts = (
                    *class_counts(candidate_train),
                    *class_counts(candidate_validation),
                )
                if all(candidate_counts):
                    train_keys = candidate_train
                    validation_keys = candidate_validation
                    break
            else:
                continue
            break

    t_g_count, v_g_count = 0, 0
    t_r_count, v_r_count = 0, 0
    t_pos, t_neg = 0, 0
    v_pos, v_neg = 0, 0

    for gk in sorted_group_keys:
        g_rows = groups[gk]
        g_pos = sum(1 for r in g_rows if r.get("training_label") == "POSITIVE")
        g_neg = sum(1 for r in g_rows if r.get("training_label") == "NEGATIVE")

        split_label = "TRAIN" if gk in train_keys else "VALIDATION"

        if split_label == "TRAIN":
            t_g_count += 1
            t_r_count += len(g_rows)
            t_pos += g_pos
            t_neg += g_neg
        else:
            v_g_count += 1
            v_r_count += len(g_rows)
            v_pos += g_pos
            v_neg += g_neg

        assignments.append(
            GroupAssignmentRecord(
                group_key=gk,
                split=split_label,
                row_count=len(g_rows),
                positive_count=g_pos,
                negative_count=g_neg,
            )
        )

    # Class coverage assertion
    if t_pos == 0 or t_neg == 0 or v_pos == 0 or v_neg == 0:
        raise MlSplitError(
            "SPLIT_CLASS_COVERAGE_ERROR: Split generated an empty class in Train or Validation"
        )

    fingerprint_payload = {
        "dataset_view_version": view.dataset_view_version,
        "feature_names": list(view.feature_names),
        "gold_manifest_sha256": view.gold_manifest_sha256,
        "gold_snapshot_id": view.gold_snapshot_id,
        "split_assignments": [a.to_dict() for a in assignments],
        "split_policy_version": split_policy_version,
        "split_seed": seed,
    }
    canonical_json = json.dumps(
        fingerprint_payload, sort_keys=True, separators=(",", ":")
    )
    split_fp = hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()
    split_id = f"split-v1-{split_fp[:16]}"

    created_at = datetime.now(timezone.utc).isoformat()

    return CandidateGroupSplit(
        split_id=split_id,
        split_fingerprint=split_fp,
        gold_snapshot_id=view.gold_snapshot_id,
        gold_manifest_sha256=view.gold_manifest_sha256,
        dataset_view_version=view.dataset_view_version,
        split_policy_version=split_policy_version,
        split_seed=seed,
        eligible_row_count=len(eligible_rows),
        eligible_group_count=len(groups),
        train_group_count=t_g_count,
        validation_group_count=v_g_count,
        train_row_count=t_r_count,
        validation_row_count=v_r_count,
        train_positive_count=t_pos,
        train_negative_count=t_neg,
        val_positive_count=v_pos,
        val_negative_count=v_neg,
        feature_names=view.feature_names,
        assignments=assignments,
        created_at=created_at,
    )


def create_anomaly_group_split(
    view: AnomalyMlView,
    seed: int = 42,
    split_policy_version: str = "anomaly-group-split-v1",
    train_ratio: float = 0.8,
) -> CandidateGroupSplit:
    """Create unsupervised group-safe deterministic split for anomaly dataset."""
    if not view.rows:
        raise MlDatasetError("EMPTY_ANOMALY_ROWS: No rows in anomaly ML view")

    groups: Dict[str, List[Dict[str, Any]]] = {}
    for r in view.rows:
        gk = derive_group_key(r)
        groups.setdefault(gk, []).append(r)

    if len(groups) < 2:
        raise MlDatasetError(
            "INSUFFICIENT_GROUPS: Anomaly dataset requires at least 2 distinct target groups"
        )

    sorted_group_keys = sorted(groups.keys())
    assignments: List[GroupAssignmentRecord] = []

    t_g_count, v_g_count = 0, 0
    t_r_count, v_r_count = 0, 0

    threshold_bucket = int(train_ratio * 10000)

    for gk in sorted_group_keys:
        g_rows = groups[gk]

        seed_payload = f"{split_policy_version}:{seed}:{gk}"
        digest = hashlib.sha256(seed_payload.encode("utf-8")).hexdigest()
        bucket = int(digest[:8], 16) % 10000

        split_label = "TRAIN" if bucket < threshold_bucket else "VALIDATION"

        if split_label == "TRAIN":
            t_g_count += 1
            t_r_count += len(g_rows)
        else:
            v_g_count += 1
            v_r_count += len(g_rows)

        assignments.append(
            GroupAssignmentRecord(
                group_key=gk,
                split=split_label,
                row_count=len(g_rows),
                positive_count=0,
                negative_count=0,
            )
        )

    if t_g_count == 0:
        raise MlSplitError(
            "EMPTY_TRAIN_SPLIT: Anomaly group split produced zero TRAIN groups"
        )
    if v_g_count == 0:
        raise MlSplitError(
            "EMPTY_VAL_SPLIT: Anomaly group split produced zero VALIDATION groups"
        )

    fingerprint_payload = {
        "dataset_view_version": view.dataset_view_version,
        "feature_names": list(view.feature_names),
        "gold_manifest_sha256": view.gold_manifest_sha256,
        "gold_snapshot_id": view.gold_snapshot_id,
        "split_assignments": [a.to_dict() for a in assignments],
        "split_policy_version": split_policy_version,
        "split_seed": seed,
    }
    canonical_json = json.dumps(
        fingerprint_payload, sort_keys=True, separators=(",", ":")
    )
    split_fp = hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()
    split_id = f"split-anom-v1-{split_fp[:16]}"

    created_at = datetime.now(timezone.utc).isoformat()

    return CandidateGroupSplit(
        split_id=split_id,
        split_fingerprint=split_fp,
        gold_snapshot_id=view.gold_snapshot_id,
        gold_manifest_sha256=view.gold_manifest_sha256,
        dataset_view_version=view.dataset_view_version,
        split_policy_version=split_policy_version,
        split_seed=seed,
        eligible_row_count=len(view.rows),
        eligible_group_count=len(groups),
        train_group_count=t_g_count,
        validation_group_count=v_g_count,
        train_row_count=t_r_count,
        validation_row_count=v_r_count,
        train_positive_count=0,
        train_negative_count=0,
        val_positive_count=0,
        val_negative_count=0,
        feature_names=view.feature_names,
        assignments=assignments,
        created_at=created_at,
    )


def save_split_manifest(
    split: CandidateGroupSplit, dest_dir: str = "manifests/ml-splits"
) -> str:
    """Save split manifest idempotently to manifests/ml-splits/<split-id>.json."""
    os.makedirs(dest_dir, exist_ok=True)
    out_path = os.path.join(dest_dir, f"{split.split_id}.json")

    split_dict = split.to_dict()
    new_json = json.dumps(split_dict, indent=2, sort_keys=True)

    if os.path.exists(out_path):
        with open(out_path, "r", encoding="utf-8") as f:
            existing_data = json.load(f)

        if existing_data.get("split_fingerprint") != split.split_fingerprint:
            raise MlSplitConflictError(
                f"ML_SPLIT_CONFLICT: Existing manifest at {out_path} has conflicting fingerprint"
            )
        return out_path

    with open(out_path, "w", encoding="utf-8") as f:
        f.write(new_json)

    return out_path


def load_split_manifest(manifest_path: str) -> CandidateGroupSplit:
    """Load CandidateGroupSplit from JSON manifest file."""
    if not os.path.exists(manifest_path):
        raise MlSplitError(f"Split manifest file not found: {manifest_path}")

    with open(manifest_path, "r", encoding="utf-8") as f:
        d = json.load(f)

    assignments = [
        GroupAssignmentRecord(
            group_key=a["group_key"],
            split=a["split"],
            row_count=a["row_count"],
            positive_count=a["positive_count"],
            negative_count=a["negative_count"],
        )
        for a in d["assignments"]
    ]

    return CandidateGroupSplit(
        schema_version=d.get("schema_version", 1),
        split_id=d["split_id"],
        split_fingerprint=d["split_fingerprint"],
        gold_snapshot_id=d["gold_snapshot_id"],
        gold_manifest_sha256=d["gold_manifest_sha256"],
        dataset_view_version=d["dataset_view_version"],
        split_policy_version=d["split_policy_version"],
        split_seed=d["split_seed"],
        eligible_row_count=d["eligible_row_count"],
        eligible_group_count=d["eligible_group_count"],
        train_group_count=d["train_group_count"],
        validation_group_count=d["validation_group_count"],
        train_row_count=d["train_row_count"],
        validation_row_count=d["validation_row_count"],
        train_positive_count=d["train_positive_count"],
        train_negative_count=d["train_negative_count"],
        val_positive_count=d["val_positive_count"],
        val_negative_count=d["val_negative_count"],
        feature_names=tuple(d["feature_names"]),
        assignments=assignments,
        created_at=d["created_at"],
    )
