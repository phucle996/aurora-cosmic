import type { ModelRecord } from '@/pages/model-registry/types';
import type { InferenceJob } from '@/pages/inference-engine/types';

export type ModelEvolutionEvidence = {
  runtime_package_id: string;
  model_id: string;
  model_version: string;
  task: string;
  model_status: string;
  parity_status: string;
  integrity_status: string;
  gate_passed: boolean;
  created_at: string;

  // Stage 01 / DATA
  gold_snapshot_id?: string;
  gold_manifest_sha256?: string;
  dataset_view_version?: string;
  dataset_view_fingerprint?: string;

  // Stage 02 / TRAIN
  training_run_id?: string;
  split_id?: string;
  feature_count?: number;
  training_run_manifest_sha256?: string;
  preprocessing_version?: string;

  // Stage 03 / EVALUATE
  evaluation_run_id?: string;
  evaluation_policy_version?: string;
  threshold_policy_version?: string;
  golden_pr_auc?: number;
  golden_recall?: number;
  evaluation_run_manifest_sha256?: string;
  metrics_sha256?: string;

  // Stage 04 / PACKAGE
  onnx_size_bytes?: number;
  onnx_sha256?: string;
  runtime_manifest_key?: string;

  golden?: {
    pr_auc?: number;
    recall?: number;
  };
};

export type EvolutionEvaluation = ModelEvolutionEvidence;

export interface ModelEvolutionEvidenceProps {
  model?: ModelRecord;
  models?: ModelRecord[];
  jobs?: InferenceJob[];
  selectedRuntimeId?: string;
  onSelectRuntimeId?: (runtimePackageID: string) => void;
  compact?: boolean;
}

export interface InferenceChartItem {
  label: string;
  rows: number;
  status: string;
  job: InferenceJob;
}
