package entity

type PageRequest struct {
	Limit  int
	Offset int
}

type Page[T any] struct {
	Items   []T
	Count   int
	Limit   int
	Offset  int
	HasMore bool
}

type Candidate struct {
	PredictionID    string
	SourceProductID string
	TICID           int64
	Sector          int
	RawLogit        float64
	CandidateScore  float64
	Threshold       float64
	AboveThreshold  bool
	ModelVersion    string
	RegisteredModel string
	SnapshotID      string
	ValidationID    string
	RuntimePkgID    string
	PredictedAt     string
}

type CandidateEvidence struct {
	LineageID                  string
	FeatureVersion             string
	FeatureFingerprint         string
	NPoints                    int64
	TimeSpan                   float64
	MedianCadence              float64
	MaxGap                     float64
	FluxMean                   float64
	FluxStd                    float64
	FluxAmplitude              float64
	FluxRMS                    float64
	MedianFluxErr              float64
	BLSAvailable               bool
	BLSPeriod                  float64
	BLSDuration                float64
	BLSTransitTime             float64
	BLSDepth                   float64
	BLSPower                   float64
	TPFEvidenceAvailable       bool
	PixelMADMedian             float64
	VariabilityPeakFraction    float64
	TransitEvidenceAvailable   bool
	TransitDeficitSum          float64
	TransitDeficitCenterOffset float64
	TICAvailable               bool
	TMag                       float64
	Teff                       float64
	StellarRadius              float64
	StellarMass                float64
	LogG                       float64
	MatchedTOIID               string
	TOIMatchStatus             string
	MatchedTCEID               string
	TCEMatchStatus             string
}

type CandidateDetail struct {
	Candidate    Candidate
	Evidence     CandidateEvidence
	Physics      PlanetPhysics
	Habitability HabitabilityAssessment
}

// PlanetPhysics is the versioned, deterministic physical interpretation of a
// transit candidate. Pointer fields are intentionally nullable: zero is a valid
// scientific value and must not be confused with missing source data.
type PlanetPhysics struct {
	PlanetCandidateID       string
	ModelVersion            string
	OrbitalPeriodDays       *float64
	TransitDepthFraction    *float64
	PlanetRadiusEarth       *float64
	SemiMajorAxisAU         *float64
	StellarLuminositySolar  *float64
	InsolationEarth         *float64
	EquilibriumTemperatureK *float64
	BondAlbedoAssumption    float64
	HZClassification        string
	ConservativeHZInnerFlux float64
	ConservativeHZOuterFlux float64
	OptimisticHZInnerFlux   float64
	OptimisticHZOuterFlux   float64
	Completeness            float64
	Warnings                []string
}

type HabitabilityComponent struct {
	Key       string  `json:"key"`
	Label     string  `json:"label"`
	Score     float64 `json:"score"`
	MaxScore  float64 `json:"max_score"`
	Available bool    `json:"available"`
	Reason    string  `json:"reason"`
}

// HabitabilityAssessment keeps deterministic physics and learned ML results
// separate. MLScore stays nil until a registered, evaluated model produces it.
type HabitabilityAssessment struct {
	AssessmentVersion string
	Status            string
	PhysicsScore      *float64
	Confidence        float64
	Tier              string
	Components        []HabitabilityComponent
	MLScore           *float64
	MLStatus          string
	Disclaimer        string
}

type Anomaly struct {
	PredictionID      string
	SourceProductID   string
	TICID             int64
	Sector            int
	ReconstructionMSE float64
	Threshold         float64
	AboveThreshold    bool
	ModelVersion      string
	RegisteredModel   string
	SnapshotID        string
	ValidationID      string
	RuntimePkgID      string
	PredictedAt       string
}

type Target struct {
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
}

type TargetQuery struct {
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

type Lightcurve struct {
	TICID  int64
	Sector int
	Time   []float64
	Flux   []float64
}
