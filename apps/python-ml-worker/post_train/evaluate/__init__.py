"""Candidate Model Evaluation Package (Thresholds, Cohorts & Evaluation Engine)."""

from post_train.evaluate.cohort import (
    EvaluationCohort,
    EvaluationCohortConflictError,
    EvaluationGroupLeakageError,
    EvaluationRunConflictError,
    InsufficientClassCoverageError,
    MlEvaluationError,
    build_candidate_golden_cohort,
    build_candidate_recent_cohort,
    check_group_contamination,
    derive_cohort_identity,
)
from post_train.evaluate.engine import (
    EvaluationRunManifest,
    derive_evaluation_run_identity,
    evaluate_candidate_model,
)
from post_train.evaluate.threshold import (
    calculate_candidate_cohort_metrics,
    compute_average_precision,
    compute_roc_auc,
    select_candidate_validation_threshold,
)

__all__ = [
    "select_candidate_validation_threshold",
    "compute_average_precision",
    "compute_roc_auc",
    "calculate_candidate_cohort_metrics",
    "MlEvaluationError",
    "EvaluationGroupLeakageError",
    "EvaluationCohortConflictError",
    "EvaluationRunConflictError",
    "InsufficientClassCoverageError",
    "EvaluationCohort",
    "derive_cohort_identity",
    "check_group_contamination",
    "build_candidate_golden_cohort",
    "build_candidate_recent_cohort",
    "EvaluationRunManifest",
    "derive_evaluation_run_identity",
    "evaluate_candidate_model",
]
