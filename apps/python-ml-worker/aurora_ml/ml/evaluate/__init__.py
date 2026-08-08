"""ML Model Evaluation Package (Phase 6.4).

Provides cohort generation, metrics computation, validation threshold selection,
and evaluation run orchestration for Candidate Vetting & Astronomical Anomaly Detection.
"""

from aurora_ml.ml.evaluate.cohort import (
    EvaluationCohort,
    EvaluationCohortConflictError,
    EvaluationGroupLeakageError,
    EvaluationRunConflictError,
    InsufficientClassCoverageError,
    MlEvaluationError,
    build_anomaly_golden_cohort,
    build_anomaly_recent_cohort,
    build_candidate_golden_cohort,
    build_candidate_recent_cohort,
    build_evaluation_cohort,
    check_group_contamination,
    derive_cohort_identity,
    load_evaluation_cohort,
    save_evaluation_cohort,
)
from aurora_ml.ml.evaluate.engine import (
    EvaluationRunManifest,
    derive_evaluation_run_identity,
    evaluate_anomaly_model,
    evaluate_candidate_model,
)
from aurora_ml.ml.evaluate.metrics import (
    apply_synthetic_standardized_shift,
    calculate_anomaly_score_distribution,
    calculate_candidate_cohort_metrics,
    compute_average_precision,
    compute_roc_auc,
    select_anomaly_validation_threshold,
    select_candidate_validation_threshold,
)

__all__ = [
    "EvaluationCohort",
    "MlEvaluationError",
    "EvaluationGroupLeakageError",
    "EvaluationCohortConflictError",
    "EvaluationRunConflictError",
    "InsufficientClassCoverageError",
    "derive_cohort_identity",
    "check_group_contamination",
    "build_candidate_golden_cohort",
    "build_candidate_recent_cohort",
    "build_anomaly_golden_cohort",
    "build_anomaly_recent_cohort",
    "build_evaluation_cohort",
    "save_evaluation_cohort",
    "load_evaluation_cohort",
    "select_candidate_validation_threshold",
    "compute_average_precision",
    "compute_roc_auc",
    "calculate_candidate_cohort_metrics",
    "select_anomaly_validation_threshold",
    "apply_synthetic_standardized_shift",
    "calculate_anomaly_score_distribution",
    "EvaluationRunManifest",
    "derive_evaluation_run_identity",
    "evaluate_candidate_model",
    "evaluate_anomaly_model",
]
