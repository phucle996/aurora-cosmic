import type { BLSSearchEvidence, CandidateAssemblyEvidence, GoldCommitEvidence, GoldMaterializationEvidence, GoldProjectionEvidence, LCFeatureEvidence, TPFSpatialEvidence } from '@/features/factory-history/types';

// Shared Bronze-to-Gold graph and preprocessing runtime contracts.
export type HopStatus =
  | 'not_observed'
  | 'idle'
  | 'running'
  | 'draining'
  | 'frozen'
  | 'catalog_syncing'
  | 'ready'
  | 'completed'
  | 'retry'
  | 'failed'
  | 'cancelling'
  | 'canceled';

export type Hop = {
  id: string;
  stepNumber: number | string;
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
  lc_feature_evidence?: LCFeatureEvidence;
  bls_search_evidence?: BLSSearchEvidence;
  tpf_spatial_evidence?: TPFSpatialEvidence;
  candidate_assembly_evidence?: CandidateAssemblyEvidence;
  gold_materialization_evidence?: GoldMaterializationEvidence;
  gold_projection_evidence?: GoldProjectionEvidence;
  gold_commit_evidence?: GoldCommitEvidence;
  scatter_points?: Array<{
    object_key: string;
    before_ppm: number;
    after_ppm: number;
    outlier_removed: number;
    preclip_samples: number;
    sigma_clip_level: number;
  }>;
  tpf_transform_points?: Array<{
    object_key: string;
    completed_at: string;
    diagnostics_observed: boolean;
    finite_pixel_fraction: number;
    input_cadences: number;
    output_cadences: number;
    input_pixel_values: number;
    normalized_pixel_values: number;
    nonfinite_pixel_values: number;
    invalid_reference_values: number;
    invalid_reference_pixels: number;
    scatter_p50_ppm: number;
    scatter_p95_ppm: number;
    drift_p50_ppm: number;
    drift_p95_ppm: number;
    boundary_jump_p50_ppm: number;
    boundary_jump_p95_ppm: number;
    chunk_count: number;
  }>;
  materialization_points?: Array<{
    object_key: string;
    product_kind: string;
    rows: number;
    size_bytes: number;
    source_bytes: number;
    encode_duration_ms: number;
    completed_at: string;
    etag: string;
    schema_version: string;
    checksum_bound: boolean;
    lineage_bound: boolean;
    size_verified: boolean;
    schema_verified: boolean;
    checkpoint_linked: boolean;
    integrity_verified: boolean;
    verification_attempts: number;
  }>;
  encode_failures?: Array<{
    object_key: string;
    product_kind: string;
    reason: string;
    recovered: boolean;
    occurred_at: string;
  }>;
  silver_failures?: Array<{
    object_key: string;
    product_kind: string;
    kind: string;
    reason: string;
    recovered: boolean;
    attempts: number;
    occurred_at: string;
  }>;
  checkpoint_points?: Array<{
    checkpoint_id: string;
    product_kind: string;
    state: string;
    schema_version: number;
    attempts: number;
    terminal: boolean;
    silver_object_key: string;
    silver_verified: boolean;
    resume_action: 'reuse_and_ack' | 'verify_silver' | 'reprocess' | 'terminal';
    last_error_kind: string;
    lifecycle_elapsed_ms: number;
    created_at: string;
    updated_at: string;
  }>;
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
	bronze_lightcurves: number;
	bronze_target_pixels: number;
	silver_total: number;
	silver_bytes: number;
	silver_lightcurves: number;
	silver_target_pixels: number;
	gold_total: number;
	gold_bytes: number;
	footprint_observed: boolean;
    checkpoint_total: number;
    checkpoint_completed: number;
    checkpoint_pending: number;
	checkpoint_failed: number;
	completed_lightcurves: number;
	completed_target_pixels: number;
    backlog_pending: number;
    backlog_ack_pending: number;
    items_to_process: number;
    observed_at?: string;
  };
  hops: Array<Pick<Hop, 'id' | 'status' | 'observed_at' | 'metrics' | 'telemetry' | 'details' | 'scatter_points' | 'tpf_transform_points' | 'materialization_points' | 'encode_failures' | 'silver_failures' | 'checkpoint_points'>>;
  edges: Array<{ id: string; source: string; target: string; status: HopStatus }>;
};

const EMPTY_PROGRESS: PreprocessingGraph['progress'] = {
  bronze_total: 0,
  bronze_bytes: 0,
  bronze_completed: 0,
  bronze_pending: 0,
  bronze_failed: 0,
  bronze_observed: false,
  bronze_lightcurves: 0,
  bronze_target_pixels: 0,
	silver_total: 0,
	silver_bytes: 0,
  silver_lightcurves: 0,
  silver_target_pixels: 0,
  gold_total: 0,
  gold_bytes: 0,
  footprint_observed: false,
  checkpoint_total: 0,
  checkpoint_completed: 0,
  checkpoint_pending: 0,
  checkpoint_failed: 0,
  completed_lightcurves: 0,
  completed_target_pixels: 0,
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
