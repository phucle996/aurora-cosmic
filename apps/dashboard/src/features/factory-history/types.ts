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
export type QuantileSummary = { min: number; p05: number; p25: number; p50: number; p75: number; p95: number; max: number };
export type LCFeatureEvidence = {
  rows: number;
  snapshot_count: number;
  total_cadences: number;
  n_points: QuantileSummary;
  time_span_days: QuantileSummary;
  median_cadence_minutes: QuantileSummary;
  max_gap_minutes: QuantileSummary;
  flux_std_ppm: QuantileSummary;
  flux_amplitude_ppm: QuantileSummary;
  flux_rms_ppm: QuantileSummary;
  median_flux_err_ppm: QuantileSummary;
};
export type BLSSearchEvidence = {
  evaluated: number;
  available: number;
  unavailable: number;
  period_days: QuantileSummary;
  duration_hours: QuantileSummary;
  depth_ppm: QuantileSummary;
  power: QuantileSummary;
  period_histogram: Array<{ label: string; count: number }>;
};
export type TPFSpatialEvidence = {
  evaluated: number;
  available: number;
  unavailable: number;
  pixel_mad: QuantileSummary;
  variability_peak_percent: QuantileSummary;
  transit_deficit_sum: QuantileSummary;
  centroid_offset_pixels: QuantileSummary;
  centroid_offset_histogram: Array<{ label: string; count: number }>;
};
export type CandidateAssemblyEvidence = {
  rows: number;
  tic_available: number;
  tic_unavailable: number;
  bls_available: number;
  transit_evidence: number;
  toi_matched: number;
  evidence_tier_histogram: Array<{ label: string; count: number }>;
  toi_match_status_histogram: Array<{ label: string; count: number }>;
};
export type GoldArtifactEvidence = {
  snapshot_id: string;
  sector: number;
  object_key: string;
  row_count: number;
  size_bytes: number;
  bytes_per_row: number;
  object_present: boolean;
  size_verified: boolean;
  checksums_declared: boolean;
};
export type GoldMaterializationEvidence = {
  batch_count: number;
  completed_batches: number;
  failed_batches: number;
  manifest_verified_batches: number;
  row_accounting_verified_batches: number;
  rows: number;
  artifact_count: number;
  total_bytes: number;
  object_verified_artifacts: number;
  checksum_declared_artifacts: number;
  artifacts: GoldArtifactEvidence[];
  issues: string[];
};
export type GoldProjectionSnapshotEvidence = {
  snapshot_id: string;
  expected_rows: number;
  ledger_indexed_rows: number;
  registry_indexed_rows: number;
  actual_candidate_rows: number;
  lightcurve_sample_rows: number;
  training_positive_rows: number;
  training_negative_rows: number;
  training_unresolved_rows: number;
  registry_status: string;
  marker_status: string;
  manifest_binding_valid: boolean;
  row_parity_valid: boolean;
};
export type GoldProjectionEvidence = {
  snapshot_count: number;
  registry_ready_snapshots: number;
  marker_verified_snapshots: number;
  row_parity_snapshots: number;
  expected_rows: number;
  indexed_rows: number;
  actual_candidate_rows: number;
  lightcurve_sample_rows: number;
  training_cohort_rows: number;
  snapshots: GoldProjectionSnapshotEvidence[];
  issues: string[];
};
export type GoldCommitSnapshotEvidence = {
  snapshot_id: string;
  completed_at?: string;
  batch_status: string;
  manifest_status: string;
  projection_status: string;
  batch_rows: number;
  manifest_rows: number;
  projected_rows: number;
  artifact_count: number;
  manifest_sha_valid: boolean;
  fingerprint_valid: boolean;
  artifact_integrity_valid: boolean;
  row_accounting_valid: boolean;
  projection_ready: boolean;
  current: boolean;
  end_to_end_valid: boolean;
};
export type GoldCommitEvidence = {
  snapshot_count: number;
  committed_snapshots: number;
  end_to_end_verified_snapshots: number;
  active_current_snapshots: number;
  rows: number;
  artifacts: number;
  snapshots: GoldCommitSnapshotEvidence[];
  issues: string[];
};
export type FactoryRunDetail = {
  run: FactoryRun;
  batches: FactoryBatch[];
  components: FactoryComponentEvent[];
  scientific_evidence?: { lc_features?: LCFeatureEvidence; bls_search?: BLSSearchEvidence; tpf_spatial?: TPFSpatialEvidence; candidate_assembly?: CandidateAssemblyEvidence; gold_materialization?: GoldMaterializationEvidence; gold_projection?: GoldProjectionEvidence; gold_commit?: GoldCommitEvidence };
};
