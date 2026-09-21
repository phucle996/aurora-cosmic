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

// HZFluxBoundaries định nghĩa ranh giới thông lượng bức xạ của vùng có thể sống được (Habitable Zone).
type HZFluxBoundaries struct {
	ConservativeInner float64 `json:"conservative_inner"`
	ConservativeOuter float64 `json:"conservative_outer"`
	OptimisticInner   float64 `json:"optimistic_inner"`
	OptimisticOuter   float64 `json:"optimistic_outer"`
}

// PlanetPhysics chứa các tham số vật lý thiên văn giải tích được suy diễn minh bạch (không tự ý điền bừa).
type PlanetPhysics struct {
	PlanetCandidateID       string           `json:"planet_candidate_id"`
	ModelVersion            string           `json:"model_version"`
	OrbitalPeriodDays       *float64         `json:"orbital_period_days"`
	TransitDepthFraction    *float64         `json:"transit_depth_fraction"`
	PlanetRadiusEarth       *float64         `json:"planet_radius_earth"`
	SemiMajorAxisAU         *float64         `json:"semi_major_axis_au"`
	StellarLuminositySolar  *float64         `json:"stellar_luminosity_solar"`
	InsolationEarth         *float64         `json:"insolation_earth"`
	EquilibriumTemperatureK *float64         `json:"equilibrium_temperature_k"`
	BondAlbedoAssumption    float64          `json:"bond_albedo_assumption"`
	HZClassification        string           `json:"hz_classification"`
	HZFluxBoundaries        HZFluxBoundaries `json:"hz_flux_boundaries"`
	Completeness            float64          `json:"completeness"`
	PlanetClassification    string           `json:"planet_classification"`
	TransitDurationHours    *float64         `json:"transit_duration_hours"`
	Warnings                []string         `json:"warnings"`
}

// HabitabilityComponent đại diện cho một tiêu chuẩn chấm điểm trong đánh giá khả năng hỗ trợ sự sống.
type HabitabilityComponent struct {
	Key       string  `json:"key"`
	Label     string  `json:"label"`
	Score     float64 `json:"score"`
	MaxScore  float64 `json:"max_score"`
	Available bool    `json:"available"`
	Reason    string  `json:"reason"`
}

// HabitabilityAssessment là bảng đánh giá tổng hợp khả năng sống được theo vật lý giải tích và ML.
type HabitabilityAssessment struct {
	AssessmentVersion string                  `json:"assessment_version"`
	Status            string                  `json:"status"`
	PhysicsScore      *float64                `json:"physics_score"`
	Confidence        float64                 `json:"confidence"`
	Tier              string                  `json:"tier"`
	Components        []HabitabilityComponent `json:"components"`
	MLScore           *float64                `json:"ml_score"`
	MLStatus          string                  `json:"ml_status"`
	Disclaimer        string                  `json:"disclaimer"`
}

// TargetEvidence chứa 31 đặc trưng trắc quang và danh mục sao TIC phục vụ kiểm tra chéo khoa học từ Gold features.
type TargetEvidence struct {
	LineageID                  string  `json:"lineage_id" ch:"lineage_id"`
	FeatureVersion             string  `json:"feature_version" ch:"feature_version"`
	FeatureFingerprint         string  `json:"feature_fingerprint" ch:"feature_fingerprint"`
	NPoints                    int64   `json:"n_points" ch:"n_points"`
	TimeSpan                   float64 `json:"time_span" ch:"time_span"`
	MedianCadence              float64 `json:"median_cadence" ch:"median_cadence"`
	MaxGap                     float64 `json:"max_gap" ch:"max_gap"`
	FluxMean                   float64 `json:"flux_mean" ch:"flux_mean"`
	FluxStd                    float64 `json:"flux_std" ch:"flux_std"`
	FluxAmplitude              float64 `json:"flux_amplitude" ch:"flux_amplitude"`
	FluxRMS                    float64 `json:"flux_rms" ch:"flux_rms"`
	MedianFluxErr              float64 `json:"median_flux_err" ch:"median_flux_err"`
	BLSAvailable               bool    `json:"bls_available" ch:"bls_available"`
	BLSPeriod                  float64 `json:"bls_period" ch:"bls_period"`
	BLSDuration                float64 `json:"bls_duration" ch:"bls_duration"`
	BLSTransitTime             float64 `json:"bls_transit_time" ch:"bls_transit_time"`
	BLSDepth                   float64 `json:"bls_depth" ch:"bls_depth"`
	BLSPower                   float64 `json:"bls_power" ch:"bls_power"`
	PixelMADMedian             float64 `json:"pixel_mad_median" ch:"pixel_mad_median"`
	VariabilityPeakFraction    float64 `json:"variability_peak_fraction" ch:"variability_peak_fraction"`
	TransitEvidenceAvailable   bool    `json:"transit_evidence_available" ch:"transit_evidence_available"`
	TransitDeficitSum          float64 `json:"transit_deficit_sum" ch:"transit_deficit_sum"`
	TransitDeficitCenterOffset float64 `json:"transit_deficit_center_offset" ch:"transit_deficit_center_offset"`
	TICAvailable               bool    `json:"tic_available" ch:"tic_available"`
	TMag                       float64 `json:"tmag" ch:"tmag"`
	Teff                       float64 `json:"teff" ch:"teff"`
	StellarRadius              float64 `json:"stellar_radius" ch:"stellar_radius"`
	StellarMass                float64 `json:"stellar_mass" ch:"stellar_mass"`
	LogG                       float64 `json:"logg" ch:"logg"`
	MatchedTOIID               string  `json:"matched_toi_id" ch:"matched_toi_id"`
	TOIMatchStatus             string  `json:"toi_match_status" ch:"toi_match_status"`
}

type TargetAIInsights struct {
	BLSPeriodDays           *float64                `json:"bls_period_days"`
	BLSDepthFraction        *float64                `json:"bls_depth_fraction"`
	BLSDurationDays         *float64                `json:"bls_duration_days"`
	BLSTransitTime          *float64                `json:"bls_transit_time"`
	SemiMajorAxisAU         *float64                `json:"semi_major_axis_au"`
	PlanetRadiusEarth       *float64                `json:"planet_radius_earth"`
	EquilibriumTempK        *float64                `json:"equilibrium_temp_k"`
	HZClassification        string                  `json:"hz_classification"`
	CandidateScore          *float64                `json:"candidate_score"`
	CandidateAboveThreshold bool                    `json:"candidate_above_threshold"`
	CandidatePredictionID   string                  `json:"candidate_prediction_id"`
	HabitabilityScore       *float64                `json:"habitability_score"`
	HabitabilityConfidence  float64                 `json:"habitability_confidence"`
	HabitabilityTier        string                  `json:"habitability_tier"`
	HabitabilityComponents  []HabitabilityComponent `json:"habitability_components,omitempty"`
	InsolationEarth         *float64                `json:"insolation_earth"`
	PlanetClassification    string                  `json:"planet_classification"`
	TransitDurationHours    *float64                `json:"transit_duration_hours"`
	Warnings                []string                `json:"warnings"`
}

type TargetInsights struct {
	Observation    TargetObservationInsight    `json:"observation"`
	StellarPhysics TargetStellarPhysicsInsight `json:"stellar_physics"`
	AIInsights     TargetAIInsights            `json:"ai_insights"`
}

type TargetInsightRecord struct {
	Target   Target
	Evidence *TargetEvidence
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
