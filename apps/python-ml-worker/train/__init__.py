"""Training Module: Device Resolution, Model Architecture, Manifests, Training Loop & Orchestration Workflow."""

from train.device import (
    ComputeTargetError,
    DeviceTargetUnavailableError,
    TrainingRuntimeInfo,
    resolve_training_device,
)
from train.loop import (
    CandidateTrainingError,
    calculate_binary_metrics,
    train_candidate_model,
)
from train.manifest import (
    TrainingRunCheckpoint,
    TrainingRunManifest,
    TrainingRunSpec,
    TrainingSpecError,
    derive_training_run_identity,
)
from train.model import (
    CandidateTabularMLP,
    FeatureAttentionGate,
    ResidualDenseBlock,
)
from train.workflow import (
    TrainingApplication,
    TrainingExecutionError,
    TrainingRequest,
    TrainingRequestError,
)

__all__ = [
    # Device
    "ComputeTargetError",
    "DeviceTargetUnavailableError",
    "TrainingRuntimeInfo",
    "resolve_training_device",
    # Model
    "CandidateTabularMLP",
    "ResidualDenseBlock",
    "FeatureAttentionGate",
    # Manifest / Spec / Checkpoint
    "TrainingSpecError",
    "derive_training_run_identity",
    "TrainingRunSpec",
    "TrainingRunManifest",
    "TrainingRunCheckpoint",
    # Training Loop
    "CandidateTrainingError",
    "calculate_binary_metrics",
    "train_candidate_model",
    # Workflow
    "TrainingApplication",
    "TrainingExecutionError",
    "TrainingRequest",
    "TrainingRequestError",
]
