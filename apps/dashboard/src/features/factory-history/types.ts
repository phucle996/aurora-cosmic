// Shared durable-run contracts consumed by history and pipeline pages.
export type FactoryRun = {
  pipeline: string;
  run_id: string;
  mode: string;
  status: string;
  started_at: string;
  finished_at?: string;
  max_batch_records: number;
  idle_flush_seconds: number;
  pending_inputs: number;
  completed_batches: number;
  input_records: number;
  output_rows: number;
  indexed_rows: number;
  last_snapshot_id?: string;
  last_error?: string;
  updated_at: string;
};

export type FactoryBatch = {
  batch_id: string;
  mode: string;
  status: string;
  started_at: string;
  completed_at?: string;
  input_records: number;
  candidate_rows: number;
  artifact_count: number;
  indexed_rows: number;
  snapshot_id?: string;
  snapshot_fingerprint?: string;
  manifest_key?: string;
  manifest_sha256?: string;
  error?: string;
};

export type FactoryComponentEvent = { component_id: string; status: string; occurred_at: string; input_records: number; output_rows: number; indexed_rows: number; snapshot_id?: string; error?: string };
export type FactoryRunDetail = { run: FactoryRun; batches: FactoryBatch[]; components: FactoryComponentEvent[] };
