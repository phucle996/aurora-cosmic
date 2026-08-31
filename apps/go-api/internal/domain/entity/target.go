package entity

type Target struct {
	GoldSnapshotID          string
	TICID                   int64
	TessMag                 float64
	RA                      float64
	Dec                     float64
	EffectiveT              float64
	SurfaceGrav             float64
	Radius                  float64
	Sector                  int
	TOI                     string
	Disposition             string
	HasLightcurve           bool
	LightcurvePoints        int64
	LightcurveTimeSpan      float64
	HasCandidate            bool
	CandidatePredictionID   string
	CandidateScore          float64
	CandidateAboveThreshold bool
	HasAnomaly              bool
	AnomalyPredictionID     string
	AnomalyScore            float64
	PipelineStatus          string
	TICContextAvailable     bool
	TOIMatchStatus          string
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
	Target       Target
	Physics      *PlanetPhysics
	Habitability *HabitabilityAssessment
	Evidence     *CandidateEvidence
}
