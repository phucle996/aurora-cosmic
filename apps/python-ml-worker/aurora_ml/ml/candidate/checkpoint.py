"""Training Run Spec, Manifest & Checkpoint Manager (training-run-v1).

Manages deterministic training run specs, immutable run manifests, and crash-recovery checkpoints.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
import hashlib
import json
from typing import Any, Dict, List, Optional, Tuple

from aurora_ml.ml.datasets.splits import CANDIDATE_MODEL_INPUT_FEATURES


class TrainingSpecError(Exception):
    """Base exception for spec/manifest errors."""

    pass


def derive_training_run_identity(
    model_version: str,
    preprocessing_version: str,
    gold_snapshot_id: str,
    split_id: str,
    dataset_view_fingerprint: str,
    feature_order: Tuple[str, ...],
    training_seed: int,
    hyperparameters: Dict[str, Any],
) -> Tuple[str, str]:
    """Derive deterministic (training_run_id, training_spec_fingerprint).

    Excludes wall-clock timestamps, hostnames, Python hash(), and random UUIDs.
    """
    canonical_obj = {
        "dataset_view_fingerprint": dataset_view_fingerprint,
        "feature_order": list(feature_order),
        "gold_snapshot_id": gold_snapshot_id,
        "hyperparameters": dict(sorted(hyperparameters.items())),
        "model_version": model_version,
        "preprocessing_version": preprocessing_version,
        "split_id": split_id,
        "training_seed": training_seed,
    }

    canonical_json = json.dumps(canonical_obj, sort_keys=True, separators=(",", ":"))
    spec_fingerprint = hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()
    run_id = f"run-cand-v1-{spec_fingerprint[:12]}"
    return run_id, spec_fingerprint


@dataclass
class TrainingRunSpec:
    """Specification defining deterministic training configuration."""

    gold_snapshot_id: str
    split_id: str
    dataset_view_fingerprint: str
    training_seed: int = 42
    model_version: str = "candidate-tabular-mlp-v1"
    preprocessing_version: str = "candidate-preprocess-v1"
    feature_order: Tuple[str, ...] = CANDIDATE_MODEL_INPUT_FEATURES
    hyperparameters: Dict[str, Any] = field(
        default_factory=lambda: {
            "batch_size": 64,
            "early_stopping_patience": 10,
            "hidden_dims": [64, 32],
            "learning_rate": 0.001,
            "max_epochs": 100,
            "weight_decay": 0.0001,
        }
    )
    training_run_id: str = field(init=False)
    training_spec_fingerprint: str = field(init=False)

    def __post_init__(self):
        run_id, fp = derive_training_run_identity(
            model_version=self.model_version,
            preprocessing_version=self.preprocessing_version,
            gold_snapshot_id=self.gold_snapshot_id,
            split_id=self.split_id,
            dataset_view_fingerprint=self.dataset_view_fingerprint,
            feature_order=self.feature_order,
            training_seed=self.training_seed,
            hyperparameters=self.hyperparameters,
        )
        self.training_run_id = run_id
        self.training_spec_fingerprint = fp


@dataclass
class TrainingRunManifest:
    """Immutable manifest specification for a committed training run (training-run-v1)."""

    training_run_id: str
    training_spec_fingerprint: str
    model_version: str
    preprocessing_version: str
    gold_snapshot_id: str
    gold_manifest_sha256: str
    split_id: str
    split_manifest_sha256: str
    dataset_view_version: str
    dataset_view_fingerprint: str
    feature_order: List[str]
    training_seed: int
    hyperparameters: Dict[str, Any]
    counts: Dict[str, int]
    best_epoch: int
    artifacts: Dict[str, str]
    schema_version: int = 1
    created_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    producer: str = "python-ml-worker"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "training_run_id": self.training_run_id,
            "training_spec_fingerprint": self.training_spec_fingerprint,
            "model_version": self.model_version,
            "preprocessing_version": self.preprocessing_version,
            "gold_snapshot_id": self.gold_snapshot_id,
            "gold_manifest_sha256": self.gold_manifest_sha256,
            "split_id": self.split_id,
            "split_manifest_sha256": self.split_manifest_sha256,
            "dataset_view_version": self.dataset_view_version,
            "dataset_view_fingerprint": self.dataset_view_fingerprint,
            "feature_order": self.feature_order,
            "training_seed": self.training_seed,
            "hyperparameters": self.hyperparameters,
            "counts": self.counts,
            "best_epoch": self.best_epoch,
            "artifacts": self.artifacts,
            "created_at": self.created_at,
            "producer": self.producer,
        }

    def to_json(self, indent: Optional[int] = 2) -> str:
        return json.dumps(self.to_dict(), indent=indent)

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "TrainingRunManifest":
        return cls(
            schema_version=d.get("schema_version", 1),
            training_run_id=d["training_run_id"],
            training_spec_fingerprint=d["training_spec_fingerprint"],
            model_version=d["model_version"],
            preprocessing_version=d["preprocessing_version"],
            gold_snapshot_id=d["gold_snapshot_id"],
            gold_manifest_sha256=d["gold_manifest_sha256"],
            split_id=d["split_id"],
            split_manifest_sha256=d["split_manifest_sha256"],
            dataset_view_version=d["dataset_view_version"],
            dataset_view_fingerprint=d["dataset_view_fingerprint"],
            feature_order=d["feature_order"],
            training_seed=d["training_seed"],
            hyperparameters=d["hyperparameters"],
            counts=d["counts"],
            best_epoch=d["best_epoch"],
            artifacts=d["artifacts"],
            created_at=d.get("created_at", ""),
            producer=d.get("producer", "python-ml-worker"),
        )


@dataclass
class TrainingRunCheckpoint:
    """Recovery checkpoint state for training run lifecycle."""

    training_run_id: str
    training_spec_fingerprint: str
    status: str  # PLANNED, TRAINING, ARTIFACT_STORED, COMPLETED, FAILED
    gold_snapshot_id: str
    split_id: str
    schema_version: int = 1
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

    def update_status(self, new_status: str, error_msg: Optional[str] = None):
        self.status = new_status
        if error_msg:
            self.error_message = error_msg
        self.updated_at = datetime.now(timezone.utc).isoformat()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "training_run_id": self.training_run_id,
            "training_spec_fingerprint": self.training_spec_fingerprint,
            "status": self.status,
            "gold_snapshot_id": self.gold_snapshot_id,
            "split_id": self.split_id,
            "current_epoch": self.current_epoch,
            "best_epoch": self.best_epoch,
            "best_val_loss": self.best_val_loss,
            "error_message": self.error_message,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }

    def to_json(self, indent: int = 2) -> str:
        return json.dumps(self.to_dict(), indent=indent)

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "TrainingRunCheckpoint":
        return cls(
            schema_version=d.get("schema_version", 1),
            training_run_id=d["training_run_id"],
            training_spec_fingerprint=d["training_spec_fingerprint"],
            status=d["status"],
            gold_snapshot_id=d["gold_snapshot_id"],
            split_id=d["split_id"],
            current_epoch=d.get("current_epoch", 0),
            best_epoch=d.get("best_epoch", 0),
            best_val_loss=d.get("best_val_loss", float("inf")),
            error_message=d.get("error_message"),
            created_at=d.get("created_at", ""),
            updated_at=d.get("updated_at", ""),
        )
