package entity

type Target struct {
	GoldSnapshotID          string  `json:"gold_snapshot_id"`
	TICID                   int64   `json:"tic_id"`
	TessMag                 float64 `json:"tess_mag"`
	RA                      float64 `json:"ra"`
	Dec                     float64 `json:"dec"`
	EffectiveT              float64 `json:"effective_t"`
	SurfaceGrav             float64 `json:"surface_grav"`
	Radius                  float64 `json:"radius"`
	Sector                  int     `json:"sector"`
	TOI                     string  `json:"matched_toi"`
	Disposition             string  `json:"disposition"`
	HasLightcurve           bool    `json:"has_lightcurve"`
	LightcurvePoints        int64   `json:"lightcurve_points"`
	LightcurveTimeSpan      float64 `json:"lightcurve_time_span"`
	HasCandidate            bool    `json:"has_candidate"`
	CandidatePredictionID   string  `json:"candidate_prediction_id"`
	CandidateScore          float64 `json:"candidate_score"`
	CandidateAboveThreshold bool    `json:"candidate_above_threshold"`
	HasAnomaly              bool    `json:"has_anomaly"`
	AnomalyPredictionID     string  `json:"anomaly_prediction_id"`
	AnomalyScore            float64 `json:"anomaly_score"`
	PipelineStatus          string  `json:"pipeline_status"`
	TICContextAvailable     bool    `json:"tic_context_available"`
	TOIMatchStatus          string  `json:"toi_match_status"`
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
	HasAnomaly     *bool
	Sort           string
	Page           PageRequest
}

type TargetDetail struct {
	Target       Target                  `json:"target"`
	Physics      *PlanetPhysics          `json:"planet_physics,omitempty"`
	Habitability *HabitabilityAssessment `json:"habitability,omitempty"`
	Evidence     *CandidateEvidence      `json:"evidence,omitempty"`
}

type TargetListResponse struct {
	Count   int          `json:"count"`
	Targets []Target     `json:"targets"`
	Page    PageMetadata `json:"page"`
}
