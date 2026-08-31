package entity

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
}

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
	Key       string
	Label     string
	Score     float64
	MaxScore  float64
	Available bool
	Reason    string
}

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

type CandidateDetail struct {
	Candidate    Candidate
	Evidence     CandidateEvidence
	Physics      PlanetPhysics
	Habitability HabitabilityAssessment
}
