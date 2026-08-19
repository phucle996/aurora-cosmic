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

type TrainingJobRequest struct {
	Task           string  `json:"task"`
	GoldSnapshotID string  `json:"gold_snapshot_id"`
	BaseModelID    string  `json:"base_model_id,omitempty"`   // Model ID gốc làm nền tảng (e.g. "champion", "model-cand-v1-...", hoặc "" để train từ đầu)
	TrainingMode   string  `json:"training_mode,omitempty"`   // "fine_tune" (kế thừa trọng số) hoặc "scratch" (tạo mới ngẫu nhiên)
	Epochs         int     `json:"epochs"`
	LearningRate   float64 `json:"learning_rate"`
	BatchSize      int     `json:"batch_size"`
	Seed           int     `json:"seed"`
	AutoPromote    bool    `json:"auto_promote"`
}

type TrainingJobResponse struct {
	JobID          string `json:"job_id"`
	Task           string `json:"task"`
	GoldSnapshotID string `json:"gold_snapshot_id"`
	Status         string `json:"status"`
	CreatedAt      string `json:"created_at"`
	Message        string `json:"message"`
}
