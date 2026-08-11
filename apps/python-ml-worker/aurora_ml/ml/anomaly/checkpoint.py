"""Anomaly Training Run Spec, Manifest & Checkpoint Manager (training-run-v1).

Manages deterministic anomaly training run specs, immutable run manifests, and crash-recovery checkpoints.
"""

import hashlib
import json
import os
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from aurora_ml.ml.datasets.splits import ANOMALY_MODEL_INPUT_FEATURES


class AnomalyTrainingSpecError(Exception):
    """Base exception for anomaly spec/manifest errors."""

    pass


def derive_anomaly_training_run_identity(
    model_version: str,
    preprocessing_version: str,
    score_definition_version: str,
    gold_snapshot_id: str,
    split_id: str,
    dataset_view_fingerprint: str,
    feature_order: Tuple[str, ...],
    training_seed: int,
    hyperparameters: Dict[str, Any],
) -> Tuple[str, str]:
    """Derive deterministic (training_run_id, training_spec_fingerprint)."""
    canonical_obj = {
        "dataset_view_fingerprint": dataset_view_fingerprint,
        "feature_order": list(feature_order),
        "gold_snapshot_id": gold_snapshot_id,
        "hyperparameters": dict(sorted(hyperparameters.items())),
        "model_version": model_version,
        "preprocessing_version": preprocessing_version,
        "score_definition_version": score_definition_version,
        "split_id": split_id,
        "training_seed": training_seed,
    }

    canonical_json = json.dumps(canonical_obj, sort_keys=True, separators=(",", ":"))
    spec_fingerprint = hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()
    run_id = f"run-anom-v1-{spec_fingerprint[:12]}"
    return run_id, spec_fingerprint


@dataclass
class AnomalyTrainingRunSpec:
    """Specification defining deterministic anomaly training configuration."""

    gold_snapshot_id: str
    split_id: str
    dataset_view_fingerprint: str
    training_seed: int = 42
    hyperparameters: Dict[str, Any] = field(default_factory=dict)
    model_version: str = "anomaly-lightcurve-autoencoder-v1"
    preprocessing_version: str = "anomaly-lightcurve-preprocess-v1"
    score_definition_version: str = "reconstruction-mse-v1"
    feature_order: Tuple[str, ...] = ANOMALY_MODEL_INPUT_FEATURES
    training_run_id: str = ""
    training_spec_fingerprint: str = ""

    def __post_init__(self):
        if not self.training_run_id or not self.training_spec_fingerprint:
            run_id, spec_fp = derive_anomaly_training_run_identity(
                model_version=self.model_version,
                preprocessing_version=self.preprocessing_version,
                score_definition_version=self.score_definition_version,
                gold_snapshot_id=self.gold_snapshot_id,
                split_id=self.split_id,
                dataset_view_fingerprint=self.dataset_view_fingerprint,
                feature_order=self.feature_order,
                training_seed=self.training_seed,
                hyperparameters=self.hyperparameters,
            )
            self.training_run_id = run_id
            self.training_spec_fingerprint = spec_fp


@dataclass
class AnomalyTrainingRunManifest:
    """Immutable manifest for a completed anomaly training run."""

    training_run_id: str
    training_spec_fingerprint: str
    task: str = "astronomical_anomaly_detection"
    model_version: str = "anomaly-lightcurve-autoencoder-v1"
    preprocessing_version: str = "anomaly-lightcurve-preprocess-v1"
    score_definition_version: str = "reconstruction-mse-v1"
    gold_snapshot_id: str = ""
    gold_manifest_sha256: str = ""
    split_id: str = ""
    split_manifest_sha256: str = ""
    dataset_view_version: str = "anomaly-lightcurve-ml-view-v1"
    dataset_view_fingerprint: str = ""
    feature_order: List[str] = field(default_factory=list)
    training_seed: int = 42
    hyperparameters: Dict[str, Any] = field(default_factory=dict)
    train_group_count: int = 0
    validation_group_count: int = 0
    train_row_count: int = 0
    validation_row_count: int = 0
    best_epoch: int = 0
    validation_reconstruction_loss: float = 0.0
    validation_score_mean: float = 0.0
    validation_score_median: float = 0.0
    validation_score_p95: float = 0.0
    validation_score_p99: float = 0.0
    validation_score_max: float = 0.0
    model_sha256: str = ""
    preprocessing_sha256: str = ""
    metrics_sha256: str = ""
    created_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    schema_version: int = 1

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    def to_json(self, indent: Optional[int] = 2) -> str:
        return json.dumps(self.to_dict(), indent=indent, sort_keys=True)

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "AnomalyTrainingRunManifest":
        return cls(**d)

    @classmethod
    def from_json(cls, json_str: str) -> "AnomalyTrainingRunManifest":
        return cls.from_dict(json.loads(json_str))


@dataclass
class AnomalyTrainingRunCheckpoint:
    """Recovery checkpoint state for anomaly training runs."""

    training_run_id: str
    training_spec_fingerprint: str
    status: str = (
        "PLANNED"  # PLANNED -> TRAINING -> ARTIFACT_STORED -> COMPLETED | FAILED
    )
    gold_snapshot_id: str = ""
    split_id: str = ""
    current_epoch: int = 0
    best_epoch: int = 0
    best_val_loss: float = float("inf")
    error_message: Optional[str] = None
    created_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    updated_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    schema_version: int = 1

    def update_status(self, new_status: str, error_msg: Optional[str] = None) -> None:
        valid_statuses = (
            "PLANNED",
            "TRAINING",
            "ARTIFACT_STORED",
            "COMPLETED",
            "FAILED",
        )
        if new_status not in valid_statuses:
            raise AnomalyTrainingSpecError(
                f"Invalid status '{new_status}'. Must be one of {valid_statuses}"
            )
        self.status = new_status
        if error_msg:
            self.error_message = error_msg
        self.updated_at = datetime.now(timezone.utc).isoformat()

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    def to_json(self, indent: Optional[int] = 2) -> str:
        return json.dumps(self.to_dict(), indent=indent, sort_keys=True)

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "AnomalyTrainingRunCheckpoint":
        return cls(**d)

    @classmethod
    def from_json(cls, json_str: str) -> "AnomalyTrainingRunCheckpoint":
        return cls.from_dict(json.loads(json_str))

    def save(self, base_dir: str = "checkpoints/ml-training/anomaly") -> str:
        os.makedirs(base_dir, exist_ok=True)
        path = os.path.join(base_dir, f"{self.training_run_id}.json")
        with open(path, "w", encoding="utf-8") as f:
            f.write(self.to_json())
        return path

    @classmethod
    def load(
        cls, training_run_id: str, base_dir: str = "checkpoints/ml-training/anomaly"
    ) -> "AnomalyTrainingRunCheckpoint":
        path = os.path.join(base_dir, f"{training_run_id}.json")
        if not os.path.exists(path):
            raise AnomalyTrainingSpecError(f"Checkpoint file not found: '{path}'")
        with open(path, "r", encoding="utf-8") as f:
            return cls.from_json(f.read())
