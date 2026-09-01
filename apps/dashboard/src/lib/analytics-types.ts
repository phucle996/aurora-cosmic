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
  training_label: 'POSITIVE' | 'NEGATIVE' | 'UNRESOLVED';
  label_source: string;
  review_status: string;
  train_eligible: boolean;
  updated_at: string;
};

export type TargetRecord = {
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

export type TargetDetailResponse = {
  target: TargetRecord;
  planet_physics?: PlanetPhysics;
  habitability?: HabitabilityAssessment;
  evidence?: CandidateEvidence;
};

export type LightcurveResponse = { tic_id: number; sector: number; time: number[]; flux: number[] };
