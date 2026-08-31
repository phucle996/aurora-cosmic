export type HopStatus =
  | 'not_observed'
  | 'running'
  | 'completed'
  | 'retry'
  | 'failed'
  | 'cancelling'
  | 'canceled';

export type Hop = {
  id: string;
  stepNumber: number;
  label: string;
  shortTitle: string;
  description: string;
  astronomyGoal: string;
  formula?: string;
  contract: string;
  status: HopStatus;
  input: string;
  output: string;
  observed_at?: string;
  metrics?: Record<string, number>;
  telemetry?: Record<string, Array<{ timestamp: number; value: number; labels?: Record<string, string> }>>;
  details?: Record<string, string>;
};

export type HopNodeData = Hop & { onSelect?: () => void };

export type PreprocessingGraph = {
  status: HopStatus;
  observation_scope: string;
  observed_at: string;
  run?: PreprocessingJob | null;
  runtime: {
    desired_workers: number;
    actual_workers: number;
    processing: number;
    throughput: number;
    completed: number;
    failed: number;
    observed_at?: string;
    workers: Array<{
      worker_id: string;
      state: string;
      product_kind?: string;
      object_key?: string;
      stage?: string;
      started_at?: string;
      updated_at?: string;
      last_duration_ms?: number;
      completed: number;
      failed: number;
    }>;
    trace: Array<{
      event: string;
      worker_id: string;
      worker_state: string;
      product_kind?: string;
      object_key?: string;
      stage?: string;
      elapsed_ms?: number;
      error?: string;
      occurred_at: string;
    }>;
  };
  progress: {
    bronze_total: number;
	bronze_bytes: number;
    bronze_completed: number;
    bronze_pending: number;
	bronze_failed: number;
    bronze_observed: boolean;
	silver_total: number;
	silver_bytes: number;
	gold_total: number;
	gold_bytes: number;
	footprint_observed: boolean;
    checkpoint_total: number;
    checkpoint_completed: number;
    checkpoint_pending: number;
	checkpoint_failed: number;
    backlog_pending: number;
    backlog_ack_pending: number;
    items_to_process: number;
    observed_at?: string;
  };
  hops: Array<Pick<Hop, 'id' | 'status' | 'observed_at' | 'metrics' | 'telemetry'>>;
  edges: Array<{ id: string; source: string; target: string; status: HopStatus }>;
};

const EMPTY_PROGRESS: PreprocessingGraph['progress'] = {
  bronze_total: 0,
  bronze_bytes: 0,
  bronze_completed: 0,
  bronze_pending: 0,
  bronze_failed: 0,
  bronze_observed: false,
  silver_total: 0,
  silver_bytes: 0,
  gold_total: 0,
  gold_bytes: 0,
  footprint_observed: false,
  checkpoint_total: 0,
  checkpoint_completed: 0,
  checkpoint_pending: 0,
  checkpoint_failed: 0,
  backlog_pending: 0,
  backlog_ack_pending: 0,
  items_to_process: 0,
};

const EMPTY_RUNTIME: PreprocessingGraph['runtime'] = {
  desired_workers: 0,
  actual_workers: 0,
  processing: 0,
  throughput: 0,
  completed: 0,
  failed: 0,
  workers: [],
  trace: [],
};

/** Accepts the valid no-telemetry response emitted during a clean bootstrap. */
export function normalizePreprocessingGraph(value: Partial<PreprocessingGraph> | null | undefined): PreprocessingGraph {
  const runtime = value?.runtime;
  return {
    status: value?.status ?? 'not_observed',
    observation_scope: value?.observation_scope ?? 'not_observed',
    observed_at: value?.observed_at ?? '',
    run: value?.run ?? null,
    runtime: {
      ...EMPTY_RUNTIME,
      ...(runtime ?? {}),
      workers: Array.isArray(runtime?.workers) ? runtime.workers : [],
      trace: Array.isArray(runtime?.trace) ? runtime.trace : [],
    },
    progress: { ...EMPTY_PROGRESS, ...(value?.progress ?? {}) },
    hops: Array.isArray(value?.hops) ? value.hops : [],
    edges: Array.isArray(value?.edges) ? value.edges : [],
  };
}

export type PreprocessingJob = {
  job_id: string;
  status: string;
  mode: string;
  worker_count: number;
  ingest_run_id?: string;
  prefix?: string;
  started_at: string;
  updated_at: string;
  error?: string;
};

export type LineageRecord = {
  tic_id: string;
  sector: number;
  target_name: string;
  planet_type: string;
  source_fits_key: string;
  source_sha256: string;
  preprocessor_version: string;
  run_id?: string;
  silver_parquet_key: string;
  silver_sha256?: string;
  silver_records?: number;
  processed_at?: string;
  integrity: 'VERIFIED' | 'PENDING' | 'CORRUPTED';
  features?: {
    transit_depth_ppm: number;
    period_days: number;
    duration_hours: number;
    snr: number;
    odd_even_mismatch: number;
    radius_earth: number;
  };
};

export type TargetProfile = {
  tic_id: string;
  sector: number;
  name: string;
  object_key: string;
  size_bytes: number;
  last_modified: string;
  description: string;
  type: string;
  period: number;
  depth: number;
  duration: number;
  radius: number;
  snr: number;
  rawNoise: number;
  stellarDriftAmp: number;
};
