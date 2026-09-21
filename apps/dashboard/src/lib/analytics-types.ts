export type CandidateRecord = {
  prediction_id: string;
  source_product_id: string;
  tic_id: number;
  sector: number;
  candidate_score: number;
  decision_threshold: number;
  above_threshold: boolean;
  model_version: string;
  gold_snapshot_id: string;
  runtime_validation_id: string;
  runtime_package_id: string;
  predicted_at: string;
};

export type CandidateEvidence = {
  lineage_id: string;
  feature_version: string;
  n_points: number;
  time_span: number;
  median_cadence: number;
  max_gap: number;
  bls_available: boolean;
  bls_period: number;
  bls_duration: number;
  bls_transit_time: number;
  bls_depth: number;
  bls_power: number;
  transit_evidence_available: boolean;
  tic_available: boolean;
  tmag: number;
  teff: number;
  stellar_radius: number;
  stellar_mass: number;
  logg: number;
  matched_toi_id: string;
  toi_match_status: string;
  median_flux_err?: number;
  flux_std?: number;
  flux_amplitude?: number;
  pixel_mad_median?: number;
  transit_deficit_center_offset?: number;
};

export type PlanetPhysics = {
  planet_candidate_id: string;
  model_version: string;
  orbital_period_days: number | null;
  transit_depth_fraction: number | null;
  planet_radius_earth: number | null;
  semi_major_axis_au: number | null;
  stellar_luminosity_solar: number | null;
  insolation_earth: number | null;
  equilibrium_temperature_k: number | null;
  bond_albedo_assumption: number;
  hz_classification: 'conservative' | 'optimistic' | 'outside' | 'unknown';
  hz_flux_boundaries: {
    conservative_inner: number;
    conservative_outer: number;
    optimistic_inner: number;
    optimistic_outer: number;
  };
  completeness: number;
  warnings: string[];
};

export type HabitabilityComponent = {
  key: string;
  label: string;
  score: number;
  max_score: number;
  available: boolean;
  reason: string;
};

export type HabitabilityAssessment = {
  assessment_version: string;
  status: 'evaluated' | 'insufficient_data';
  physics_score: number | null;
  confidence: number;
  tier: string;
  components: HabitabilityComponent[];
  ml_score: number | null;
  ml_status: string;
  disclaimer: string;
};

export type CandidateDetailResponse = {
  candidate: CandidateRecord;
  evidence: CandidateEvidence;
  review: CandidateReview;
  planet_physics: PlanetPhysics;
  habitability: HabitabilityAssessment;
  snapshot_id: string;
};

export type CandidateReview = {
  decision: 'CONFIRMED' | 'REJECTED' | 'FOLLOW_UP' | 'PENDING';
  review_status: string;
  reviewer: string;
  note: string;
  updated_at: string;
};

export type Target = {
  gold_snapshot_id: string;
  tic_id: number;
  tess_mag: number;
  ra: number;
  dec: number;
  effective_t: number;
  surface_grav: number;
  radius: number;
  sector: number;
  matched_toi: string;
  disposition: string;
  has_lightcurve: boolean;
  lightcurve_points: number;
  lightcurve_time_span: number;
  has_candidate: boolean;
  candidate_prediction_id: string;
  candidate_score: number;
  candidate_above_threshold: boolean;
  pipeline_status: string;
  tic_context_available: boolean;
  toi_match_status: string;
};

export type TargetObservationInsight = {
  tess_mag: number;
  sector: number;
  ra: number;
  dec: number;
  matched_toi: string;
  sampling_cadence_minutes: number;
  lightcurve_points: number;
  lightcurve_time_span_days: number;
  max_data_gap_days: number;
  max_data_gap_hours: number;
  photometric_noise_ppm: number;
};

export type TargetStellarPhysicsInsight = {
  teff: number;
  radius: number;
  mass: number;
  logg: number;
  spectral_class_label: string;
  evolution_status: string;
  stellar_density_gcc: number;
  escape_velocity_kms: number;
  bolometric_mag: number | null;
  hz_inner_au: number;
  hz_outer_au: number;
  hz_luminosity_solar: number;
  flux_std_ppm: number | null;
  flux_amplitude_pct: number | null;
};

export type TargetAIInsights = {
  bls_period_days: number | null;
  bls_depth_fraction: number | null;
  bls_duration_days: number | null;
  bls_transit_time: number | null;
  semi_major_axis_au: number | null;
  planet_radius_earth: number | null;
  equilibrium_temp_k: number | null;
  hz_classification: string;
  candidate_score: number | null;
  candidate_above_threshold: boolean;
  candidate_prediction_id: string;
  habitability_score: number | null;
  habitability_confidence: number;
  habitability_tier: string;
  warnings: string[];
};

export type TargetInsights = {
  observation: TargetObservationInsight;
  stellar_physics: TargetStellarPhysicsInsight;
  ai_insights: TargetAIInsights;
};

export type TargetInsightResponse = {
  target: Target;
  insights: TargetInsights;
};

export type TPFSample = {
  rows: number;
  cols: number;
  aperture_mask: number[];
  median_flux_map: number[];
  difference_flux_map: number[];
  centroid_row: number;
  centroid_col: number;
  centroid_offset_pixels: number;
  pixel_mad_median: number;
  variability_peak_fraction: number;
};

export type TargetObservationResponse = {
  tic_id: number;
  sector: number;
  lightcurve: {
    points: number;
    time: number[];
    flux: number[];
  };
  tpf?: TPFSample;
};

export type LightcurveResponse = {
  tic_id: number;
  sector: number;
  time: number[];
  flux: number[];
};
