"""Stage 1: Pre-training data preparation, dataset views, splits & preprocessor."""

from pre_train.preprocessor import CandidatePreprocessor, PreprocessingError
from pre_train.splits import (
    CandidateGroupSplit,
    GroupAssignmentRecord,
    MlSplitConflictError,
    MlSplitError,
    create_anomaly_group_split,
    create_deterministic_group_split,
    derive_group_key,
    load_split_manifest,
    save_split_manifest,
)
from pre_train.view import (
    ANOMALY_MODEL_INPUT_FEATURES,
    CANDIDATE_MODEL_INPUT_FEATURES,
    LEAKAGE_EXCLUSIONS,
    AnomalyMlView,
    CandidateMlView,
    MlDatasetError,
    build_anomaly_ml_view,
    build_candidate_ml_view,
    derive_view_fingerprint,
)

__all__ = [
    "CANDIDATE_MODEL_INPUT_FEATURES",
    "ANOMALY_MODEL_INPUT_FEATURES",
    "LEAKAGE_EXCLUSIONS",
    "MlDatasetError",
    "CandidateMlView",
    "AnomalyMlView",
    "derive_view_fingerprint",
    "build_candidate_ml_view",
    "build_anomaly_ml_view",
    "MlSplitError",
    "MlSplitConflictError",
    "GroupAssignmentRecord",
    "CandidateGroupSplit",
    "derive_group_key",
    "create_deterministic_group_split",
    "create_anomaly_group_split",
    "save_split_manifest",
    "load_split_manifest",
    "CandidatePreprocessor",
    "PreprocessingError",
]
