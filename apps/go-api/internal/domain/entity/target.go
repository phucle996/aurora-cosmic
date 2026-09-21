package entity

type Target struct {
	GoldSnapshotID          string  `json:"gold_snapshot_id" ch:"gold_snapshot_id"`
	TICID                   int64   `json:"tic_id" ch:"tic_id"`
	TessMag                 float64 `json:"tess_mag" ch:"tess_mag"`
	RA                      float64 `json:"ra" ch:"ra"`
	Dec                     float64 `json:"dec" ch:"dec"`
	EffectiveT              float64 `json:"effective_t" ch:"effective_t"`
	SurfaceGrav             float64 `json:"surface_grav" ch:"surface_grav"`
	Radius                  float64 `json:"radius" ch:"radius"`
	Sector                  int32   `json:"sector" ch:"sector"`
	TOI                     string  `json:"matched_toi" ch:"matched_toi"`
	Disposition             string  `json:"disposition" ch:"disposition"`
	HasLightcurve           bool    `json:"has_lightcurve" ch:"has_lightcurve"`
	LightcurvePoints        int64   `json:"lightcurve_points" ch:"lightcurve_points"`
	LightcurveTimeSpan      float64 `json:"lightcurve_time_span" ch:"lightcurve_time_span"`
	HasCandidate            bool    `json:"has_candidate" ch:"has_candidate"`
	CandidatePredictionID   string  `json:"candidate_prediction_id" ch:"candidate_prediction_id"`
	CandidateScore          float64 `json:"candidate_score" ch:"candidate_score"`
	CandidateAboveThreshold bool    `json:"candidate_above_threshold" ch:"candidate_above_threshold"`
	PipelineStatus          string  `json:"pipeline_status" ch:"pipeline_status"`
	TICContextAvailable     bool    `json:"tic_context_available" ch:"tic_context_available"`
	TOIMatchStatus          string  `json:"toi_match_status" ch:"toi_match_status"`
}

type TargetQuery struct {
	// SnapshotID pins all Gold-derived fields and predictions to one immutable,
	// READY snapshot. Empty selects the latest READY snapshot server-side.
	SnapshotID     string
	TICID          int64
	Sector         int
	TessMagMin     *float64
	TessMagMax     *float64
	EffectiveTMin  *float64
	EffectiveTMax  *float64
	RAMin          *float64
	RAMax          *float64
	DecMin         *float64
	DecMax         *float64
	PipelineStatus string
	HasLightcurve  *bool
	HasCandidate   *bool
	Sort           string
	Page           PageRequest
}

type TargetObservationInsight struct {
	TessMag                float64 `json:"tess_mag"`
	Sector                 int32   `json:"sector"`
	RA                     float64 `json:"ra"`
	Dec                    float64 `json:"dec"`
	MatchedTOI             string  `json:"matched_toi"`
	SamplingCadenceMinutes float64 `json:"sampling_cadence_minutes"`
	LightcurvePoints       int64   `json:"lightcurve_points"`
	LightcurveTimeSpanDays float64 `json:"lightcurve_time_span_days"`
	MaxDataGapDays         float64 `json:"max_data_gap_days"`
	MaxDataGapHours        float64 `json:"max_data_gap_hours"`
	PhotometricNoisePPM    float64 `json:"photometric_noise_ppm"`
}

type TargetStellarPhysicsInsight struct {
	Teff               float64  `json:"teff"`
	Radius             float64  `json:"radius"`
	Mass               float64  `json:"mass"`
	LogG               float64  `json:"logg"`
	SpectralClassLabel string   `json:"spectral_class_label"`
	EvolutionStatus    string   `json:"evolution_status"`
	StellarDensityGCC  float64  `json:"stellar_density_gcc"`
	EscapeVelocityKMS  float64  `json:"escape_velocity_kms"`
	BolometricMag      *float64 `json:"bolometric_mag"`
	HZInnerAU          float64  `json:"hz_inner_au"`
	HZOuterAU          float64  `json:"hz_outer_au"`
	HZLuminositySolar  float64  `json:"hz_luminosity_solar"`
	FluxStdPPM         *float64 `json:"flux_std_ppm"`
	FluxAmplitudePct   *float64 `json:"flux_amplitude_pct"`
}

type TargetAIInsights struct {
	BLSPeriodDays           *float64 `json:"bls_period_days"`
	BLSDepthFraction        *float64 `json:"bls_depth_fraction"`
	BLSDurationDays         *float64 `json:"bls_duration_days"`
	BLSTransitTime          *float64 `json:"bls_transit_time"`
	SemiMajorAxisAU         *float64 `json:"semi_major_axis_au"`
	PlanetRadiusEarth       *float64 `json:"planet_radius_earth"`
	EquilibriumTempK        *float64 `json:"equilibrium_temp_k"`
	HZClassification        string   `json:"hz_classification"`
	CandidateScore          *float64 `json:"candidate_score"`
	CandidateAboveThreshold bool     `json:"candidate_above_threshold"`
	CandidatePredictionID   string   `json:"candidate_prediction_id"`
	HabitabilityScore       *float64 `json:"habitability_score"`
	HabitabilityConfidence  float64  `json:"habitability_confidence"`
	HabitabilityTier        string   `json:"habitability_tier"`
	Warnings                []string `json:"warnings"`
}

type TargetInsights struct {
	Observation    TargetObservationInsight    `json:"observation"`
	StellarPhysics TargetStellarPhysicsInsight `json:"stellar_physics"`
	AIInsights     TargetAIInsights            `json:"ai_insights"`
}

type TargetInsightRecord struct {
	Target   Target
	Evidence *CandidateEvidence
}

type TargetInsightResponse struct {
	Target   Target         `json:"target"`
	Insights TargetInsights `json:"insights"`
}

type TargetListResponse struct {
	Count   int          `json:"count"`
	Targets []Target     `json:"targets"`
	Page    PageMetadata `json:"page"`
}

type TPFSample struct {
	Rows                 int       `json:"rows"`
	Cols                 int       `json:"cols"`
	ApertureMask         []int     `json:"aperture_mask"`
	MedianFluxMap        []float64 `json:"median_flux_map"`
	DifferenceFluxMap    []float64 `json:"difference_flux_map"`
	CentroidRow          float64   `json:"centroid_row"`
	CentroidCol          float64   `json:"centroid_col"`
	CentroidOffsetPixels float64   `json:"centroid_offset_pixels"`
	PixelMADMedian       float64   `json:"pixel_mad_median"`
	VariabilityPeakFrac  float64   `json:"variability_peak_fraction"`
}

type TargetObservationResponse struct {
	TICID      int64               `json:"tic_id"`
	Sector     int                 `json:"sector"`
	Lightcurve TargetObservationLC `json:"lightcurve"`
	TPF        *TPFSample          `json:"tpf,omitempty"`
}

type TargetObservationLC struct {
	Points int       `json:"points"`
	Time   []float64 `json:"time"`
	Flux   []float64 `json:"flux"`
}
