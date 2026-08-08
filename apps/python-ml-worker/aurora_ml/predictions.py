"""Prediction Record Data Structures & Model Input Hashing (Phase 7.1).

Defines CandidatePredictionRecord and AnomalyPredictionRecord conforming to
prediction-candidate-v1 and prediction-anomaly-v1.
"""

from dataclasses import asdict, dataclass
import hashlib
from typing import Any, Dict, List, Optional, Tuple
import numpy as np


def compute_model_input_sha256(standardized_features: List[float]) -> str:
    """Compute deterministic SHA-256 hash across explicit little-endian float32 bytes."""
    arr = np.asarray(standardized_features, dtype="<f4")
    hasher = hashlib.sha256()
    hasher.update(arr.tobytes())
    return hasher.hexdigest()


def compute_candidate_prediction_id(
    runtime_package_id: str,
    gold_snapshot_id: str,
    source_product_id: str,
) -> Tuple[str, str]:
    """Compute deterministic candidate prediction ID and fingerprint."""
    payload = {
        "task": "candidate_vetting",
        "runtime_package_id": runtime_package_id,
        "gold_snapshot_id": gold_snapshot_id,
        "source_product_id": source_product_id,
    }
    canonical = f"pred-cand-v1:{runtime_package_id}:{gold_snapshot_id}:{source_product_id}".encode("utf-8")
    fp = hashlib.sha256(canonical).hexdigest()
    pred_id = f"pred-cand-v1-{fp[:16]}"
    return pred_id, fp


def compute_anomaly_prediction_id(
    runtime_package_id: str,
    gold_snapshot_id: str,
    source_product_id: str,
) -> Tuple[str, str]:
    """Compute deterministic anomaly prediction ID and fingerprint."""
    canonical = f"pred-anom-v1:{runtime_package_id}:{gold_snapshot_id}:{source_product_id}".encode("utf-8")
    fp = hashlib.sha256(canonical).hexdigest()
    pred_id = f"pred-anom-v1-{fp[:16]}"
    return pred_id, fp


@dataclass(frozen=True)
class CandidatePredictionRecord:
    """Candidate vetting prediction record conforming to prediction-candidate-v1."""

    schema_version: int
    prediction_id: str
    prediction_fingerprint: str
    task: str
    job_id: str
    gold_snapshot_id: str
    gold_artifact_key: str
    source_product_id: str
    tic_id: int
    sector: int
    runtime_package_id: str
    runtime_validation_id: str
    registered_model_id: str
    evaluation_run_id: str
    dataset_view_version: str
    model_input_sha256: str
    raw_logit: float
    candidate_score: float
    decision_threshold: float
    above_threshold: bool
    predicted_at: str
    sample_id: Optional[str] = None
    score_definition_version: str = "candidate-sigmoid-score-v1"
    producer: str = "rust-inference"

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class AnomalyPredictionRecord:
    """Anomaly prediction record conforming to prediction-anomaly-v1."""

    schema_version: int
    prediction_id: str
    prediction_fingerprint: str
    task: str
    job_id: str
    gold_snapshot_id: str
    gold_artifact_key: str
    source_product_id: str
    tic_id: int
    sector: int
    runtime_package_id: str
    runtime_validation_id: str
    registered_model_id: str
    evaluation_run_id: str
    dataset_view_version: str
    model_input_sha256: str
    reconstruction_mse: float
    decision_threshold: float
    above_threshold: bool
    predicted_at: str
    sample_id: Optional[str] = None
    score_definition_version: str = "reconstruction-mse-v1"
    producer: str = "rust-inference"

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)
