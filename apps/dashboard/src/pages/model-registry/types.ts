/**
 * @file types.ts
 * @description Types and formatting utilities for Model Registry and lifecycle management.
 */

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

export type ModelResponse = { models: ModelRecord[] };

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
