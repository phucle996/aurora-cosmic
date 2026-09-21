/**
 * @file types.ts
 * @description Types for Model Evaluation boards, cohorts, and metric drift analysis.
 */

export type EvaluationCohortMetrics = {
  row_count: number;
  positive_count: number;
  negative_count: number;
  pr_auc?: number;
  roc_auc?: number;
  precision?: number;
  recall?: number;
  f1?: number;
  confusion_matrix?: number[][];
};

export type ModelEvaluation = {
  runtime_package_id: string;
  model_id: string;
  model_version: string;
  task: string;
  model_status: string;
  parity_status: string;
  integrity_status: string;
  evaluation_run_id: string;
  training_run_id: string;
  golden_cohort_id: string;
  recent_cohort_id?: string;
  evaluation_policy_version: string;
  threshold_policy_version: string;
  decision_threshold: number;
  validation_row_count: number;
  validation_precision?: number;
  validation_recall?: number;
  validation_f1?: number;
  golden: EvaluationCohortMetrics;
  recent?: EvaluationCohortMetrics;
  pr_auc_drift?: number;
  recall_drift?: number;
  evaluation_manifest_key: string;
  metrics_sha256: string;
  created_at: string;
};

