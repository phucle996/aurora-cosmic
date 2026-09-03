// Shared AI Factory model, training, evaluation, and inference contracts.
export type ModelRecord = {
  model_id: string;
  runtime_package_id: string;
  task: string;
  model_version: string;
  status: string;
  runtime_manifest_key: string;
  preprocessing_version: string;
  feature_count: number;
  feature_order: string[];
  onnx_size_bytes: number;
  onnx_sha256: string;
  decision_threshold: number;
  parity_status: string;
  integrity_status: string;
  evaluation_run_id: string;
  created_at: string;
  gold_snapshot_id?: string;
};

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
  gold_snapshot_id?: string;
  gold_manifest_sha256?: string;
  split_id?: string;
  dataset_view_version?: string;
  dataset_view_fingerprint?: string;
  training_run_manifest_sha256?: string;
  evaluation_run_manifest_sha256?: string;
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
  runtime_manifest_key: string;
  preprocessing_version: string;
  feature_count: number;
  onnx_size_bytes: number;
  onnx_sha256: string;
  metrics_sha256: string;
  created_at: string;
};

export type InferenceJob = {
  job_id: string;
  task: string;
  model_id: string;
  model_version: string;
  runtime_package_id: string;
  gold_snapshot_id: string;
  gold_artifact_key: string;
  sector: number;
  expected_prediction_count: number;
  created_at: string;
  status: string;
  output_key?: string;
  output_sha256?: string;
  processed_rows?: number;
  attempt?: number;
  started_at?: string;
  updated_at?: string;
  error?: string;
  producer?: string;
};

export type TrainingResponse = {
  job_id: string;
  task: string;
  gold_snapshot_id: string;
  gold_snapshot_ids?: string[];
  status: string;
  created_at: string;
  message: string;
  compute_target: 'cpu' | 'gpu';
};

export type ModelResponse = { models: ModelRecord[] };
export type JobResponse = { jobs: InferenceJob[] };
export type GoldSnapshotInventoryResponse = { snapshots: Array<{ snapshot_id: string; manifest_key: string; size_bytes: number; last_modified: string; created_at: string; status: string }> };
export type ModelDeployResponse = {
  status: string;
  model_id: string;
  task: string;
  active: boolean;
  message: string;
  ticket_id?: string;
  runtime_validation_id?: string;
  engine?: string;
  max_absolute_error?: number;
  max_relative_error?: number;
};

export type ModelPromotionState = {
  ticketId: string;
  runtimePackageId: string;
  status: 'running' | 'completed' | 'failed';
  phase: string;
  progressPercent: number;
  message: string;
  parityCases?: number;
  runtimeValidationId?: string;
  engine?: string;
  maxAbsoluteError?: number;
  maxRelativeError?: number;
  error?: string;
};

export type GoldSnapshotItem = {
  snapshot_id: string;
  key: string;
  size_bytes: number;
  last_modified: string;
  is_trained: boolean;
  trained_model_id?: string;
};

export interface ActiveTrainingState {
  jobId: string;
  task: string;
  snapshotCount: number;
  baseModel: string;
  epochs: number;
  computeTarget?: 'cpu' | 'gpu';
  startedAt: number;
  status: 'queued' | 'running' | 'completed' | 'failed';
  phase?: string;
  progressPercent?: number;
  currentEpoch?: number;
  totalEpochs?: number;
  bestEpoch?: number;
  bestValidationLoss?: number;
  updatedAt?: string;
}

export type TaskType = 'all' | 'candidate_vetting';

export const taskLabel: Record<string, string> = {
  candidate_vetting: 'Candidate vetting (Exoplanets)',
};

export function formatBytes(bytes: number): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatDate(value: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

export function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'champion' || status === 'completed') return 'default';
  if (status === 'invalid') return 'destructive';
  if (status === 'validated' || status === 'planned') return 'secondary';
  return 'outline';
}
