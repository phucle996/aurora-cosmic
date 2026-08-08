package entity

type RuntimeManifest struct {
	RuntimePackageID      string
	Task                  string
	SourceModelID         string
	ModelVersion          string
	PreprocessingVersion  string
	PreprocessingSHA256   string
	ThresholdSHA256       string
	ParityFixtureSHA256   string
	FeatureOrder          []string
	ONNXSizeBytes         int64
	ONNXSHA256            string
	DecisionThreshold     float64
	PythonParityStatus    string
	SourceEvaluationRunID string
	CreatedAt             string
}

type Model struct {
	ModelID              string
	RuntimePackageID     string
	Task                 string
	ModelVersion         string
	Status               string
	RuntimeManifestKey   string
	PreprocessingVersion string
	FeatureCount         int
	FeatureOrder         []string
	ONNXSizeBytes        int64
	ONNXSHA256           string
	DecisionThreshold    float64
	ParityStatus         string
	IntegrityStatus      string
	EvaluationRunID      string
	CreatedAt            string
}

type InferenceJobManifest struct {
	SchemaVersion             int
	JobID                     string
	JobFingerprint            string
	Task                      string
	GoldSnapshotID            string
	GoldManifestKey           string
	GoldArtifactKey           string
	GoldArtifactContentSHA256 string
	GoldArtifactRowCount      int64
	Sector                    int
	RuntimePackageID          string
	RuntimeManifestKey        string
	RuntimeManifestSHA256     string
	RuntimeValidationID       string
	ModelID                   string
	ModelVersion              string
	EvaluationRunID           string
	ExpectedPredictionCount   int64
	CreatedAt                 string
}

type InferenceJob struct {
	JobID                   string
	Task                    string
	ModelID                 string
	ModelVersion            string
	RuntimePackageID        string
	GoldSnapshotID          string
	GoldArtifactKey         string
	Sector                  int
	ExpectedPredictionCount int64
	CreatedAt               string
	Status                  string
	OutputKey               string
}
