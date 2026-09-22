export type ScientificReviewEvidence = {
  n_points: number;
  time_span_days: number;
  sector_baseline_days: number;
  sector_coverage_percent: number;
  largest_gap_hours: number;
  median_cadence_minutes: number;
  flux_std_ppm: number;
  flux_amplitude_ppm: number;
  median_flux_err_ppm: number;
  bls_available: boolean;
  bls_period_days: number;
  bls_duration_hours: number;
  bls_transit_time_btjd: number;
  bls_depth_ppm: number;
  bls_power: number;
  variability_peak_fraction: number;
  transit_evidence_available: boolean;
  transit_deficit_sum: number;
  centroid_offset_pixels: number;
  transit_deficit_center_offset_pixels?: number;
  centroid_row?: number;
  centroid_col?: number;
  tmag?: number;
  teff?: number;
  stellar_radius?: number;
  stellar_mass?: number;
  logg?: number;
  toi_match_status: string;
  matched_toi_id: string;
};

export type LightcurveSeries = {
  time: number[];
  flux: number[];
};

export type ModelSuggestion = {
  candidate_score: number;
  decision_threshold: number;
  above_threshold: boolean;
  model_id: string;
  model_version: string;
  runtime_package_id: string;
  predicted_at: string;
};

export type LabelingTargetDetail = ScientificReviewEvidence & {
  snapshot_id: string;
  source_product_id: string;
  tic_id: number;
  sector: number;
  training_label: 'POSITIVE' | 'NEGATIVE' | 'UNRESOLVED';
  label_source: string;
  review_status: string;
  review_reason?: string;
  confidence: number;

  prediction_available?: boolean;
  candidate_score?: number;
  decision_threshold?: number;
  above_threshold?: boolean;
  model_id?: string;
  model_version?: string;
  runtime_package_id?: string;
  predicted_at?: string;
};

export type LabelingSnapshotItem = {
  snapshot_id: string;
  last_modified: string;
  size_bytes: number;
  row_count?: number;
};

export type LabelingSnapshotsResponse = {
  snapshots: LabelingSnapshotItem[];
};

export type AIDecisionRecommendation = {
  suggestedLabel: 'POSITIVE' | 'NEGATIVE' | 'UNRESOLVED';
  suggestedReason: string;
  suggestedReasonLabel: string;
  suggestedConfidence: '0.9' | '0.7' | '0.5';
  confidenceLabel: string;
  rationale: string;
  keyFactors: string[];
};

export type LabelingCohortDisposition = {
  total_rows: number;
  positive_rows: number;
  negative_rows: number;
  unresolved_rows: number;
  positive_targets: number;
  negative_targets: number;
};

export type LabelingQueueSummaryItem = {
  snapshot_id: string;
  source_product_id: string;
  tic_id: number;
  sector: number;
  bls_power: number;
  toi_match_status: string;
  matched_toi_id?: string;
  candidate_score?: number;
  above_threshold?: boolean;
};

export type LabelingCohortWorkspace = {
  disposition: LabelingCohortDisposition;
  queue: {
    items: LabelingQueueSummaryItem[];
    total_count: number;
    limit: number;
    offset: number;
    has_more: boolean;
  };
};

export type TrainingReadiness = {
  total_rows: number;
  positive_rows: number;
  negative_rows: number;
  unresolved_rows: number;
  positive_targets: number;
  negative_targets: number;
  ready: boolean;
  tier: 'BLOCKED' | 'EXPERIMENTAL' | 'PRODUCTION_CANDIDATE';
  policy_version: string;
  experimental_minimum_positive_targets: number;
  experimental_minimum_negative_targets: number;
  production_candidate_minimum_positive_targets: number;
  production_candidate_minimum_negative_targets: number;
  negative_diversity_target: number;
  negative_diversity_target_met: boolean;
};

export const DECISION_BASIS_OPTIONS: { value: string; label: string; description: string }[] = [
  { value: 'PERIODIC_TRANSIT_SHAPE', label: 'Periodic transit shape', description: 'Dạng quá cảnh chữ U định kỳ rõ nét' },
  { value: 'CATALOG_CONFIRMED', label: 'Catalog-confirmed target', description: 'Trùng khớp mục tiêu đã xác nhận trong TOI' },
  { value: 'COHERENT_BLS_SIGNAL', label: 'Coherent BLS signal', description: 'Tín hiệu BLS đồng pha mạch lạc cao' },
  { value: 'ECLIPSING_BINARY', label: 'Eclipsing-binary signature', description: 'Độ sâu quá cảnh lớn, dấu hiệu hệ sao đôi' },
  { value: 'STELLAR_VARIABILITY', label: 'Stellar variability', description: 'Quang thông biến thiên tự nhiên của sao' },
  { value: 'CENTROID_CONTAMINATION', label: 'Centroid contamination', description: 'Độ lệch tâm khối lớn, nhiễm quang sao nền' },
  { value: 'INSTRUMENTAL_SYSTEMATIC', label: 'Instrumental systematic', description: 'Nhiễu thiết bị hoặc trôi phông đo lường' },
  { value: 'INSUFFICIENT_EVIDENCE', label: 'Insufficient evidence', description: 'Dữ liệu quá thưa hoặc khoảng trống lớn' },
];

export const CONFIDENCE_OPTIONS: { value: '0.9' | '0.7' | '0.5'; label: string; tier: string }[] = [
  { value: '0.9', label: 'High (90%)', tier: 'Độ tin cậy cao (High)' },
  { value: '0.7', label: 'Medium (70%)', tier: 'Độ tin cậy trung bình (Medium)' },
  { value: '0.5', label: 'Low (50%)', tier: 'Độ tin cậy thấp / Thận trọng (Low)' },
];
