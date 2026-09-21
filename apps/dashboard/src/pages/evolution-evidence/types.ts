import type { ModelRecord } from '@/pages/model-registry/types';
import type { InferenceJob } from '@/pages/inference-engine/types';
import type { ModelEvaluation } from '@/pages/model-evaluation/types';

export type EvolutionEvaluation = ModelEvaluation & {
  gold_snapshot_id?: string;
  gold_manifest_sha256?: string;
  split_id?: string;
  dataset_view_version?: string;
  dataset_view_fingerprint?: string;
  training_run_manifest_sha256?: string;
  evaluation_run_manifest_sha256?: string;
  feature_count?: number;
  onnx_size_bytes?: number;
  onnx_sha256?: string;
  preprocessing_version?: string;
  runtime_manifest_key?: string;
};

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
