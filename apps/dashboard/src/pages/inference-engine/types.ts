/**
 * @file types.ts
 * @description Types for Inference Engine jobs and batch executions.
 */

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

export type JobResponse = { jobs: InferenceJob[] };
