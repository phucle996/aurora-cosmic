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
  evaluation_run_id: string;
  created_at: string;
  gold_snapshot_id?: string;
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
};

export type TrainingResponse = {
  job_id: string;
  task: string;
  gold_snapshot_id: string;
  status: string;
  created_at: string;
  message: string;
};

export type ModelResponse = { models: ModelRecord[] };
export type JobResponse = { jobs: InferenceJob[] };
export type StorageResponse = { objects: { key: string; size_bytes?: number; last_modified?: string }[] };
export type ModelDeployResponse = { status: string; model_id: string; task: string; active: boolean; message: string };

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
  startedAt: number;
}

export type TaskType = 'all' | 'candidate_vetting' | 'astronomical_anomaly_detection';

export const taskLabel: Record<string, string> = {
  candidate_vetting: 'Candidate vetting (Exoplanets)',
  astronomical_anomaly_detection: 'Anomaly detection (Autoencoder)',
};

export function formatBytes(bytes: number): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
