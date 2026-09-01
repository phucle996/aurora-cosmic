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
type TrainingJobSpec struct {
	Task            string
	GoldSnapshotID  string
	GoldSnapshotIDs []string
	BaseModelID     string
	TrainingMode    string
	Epochs          int
	LearningRate    float64
	BatchSize       int
	Seed            int
	AutoPromote     bool
	// ComputeTarget is the explicitly selected execution branch: "cpu" or "gpu".
	ComputeTarget string
}

type TrainingJobResult struct {
	JobID           string
	Task            string
	GoldSnapshotID  string
	GoldSnapshotIDs []string
	Status          string
	CreatedAt       string
	Message         string
	ComputeTarget   string
}

// TrainingReadiness is the measured supervised-label coverage for an immutable
// set of Candidate Gold snapshots. Candidate discovery rows may be unlabelled;
// they must never be silently treated as negative examples for model training.
type TrainingReadiness struct {
	SnapshotID      string   `json:"snapshot_id,omitempty"`
	SnapshotIDs     []string `json:"snapshot_ids"`
	TotalRows       int64    `json:"total_rows"`
	PositiveRows    int64    `json:"positive_rows"`
	NegativeRows    int64    `json:"negative_rows"`
	UnresolvedRows  int64    `json:"unresolved_rows"`
	PositiveTargets int64    `json:"positive_targets"`
	NegativeTargets int64    `json:"negative_targets"`
	Ready           bool     `json:"ready"`
	PolicyVersion   string   `json:"policy_version"`
	Blocker         string   `json:"blocker,omitempty"`
}

// TrainingLabelOverride is a human-reviewed correction to the derived cohort.
// It never changes the immutable Candidate Gold row.
type TrainingLabelOverride struct {
	SnapshotID      string
	SourceProductID string
	TrainingLabel   string
}

// TrainingReview is one durable human decision in the mutable training cohort.
type TrainingReview struct {
	SnapshotID      string `json:"snapshot_id"`
	SourceProductID string `json:"source_product_id"`
	TICID           int64  `json:"tic_id"`
	Sector          int    `json:"sector"`
	TrainingLabel   string `json:"training_label"`
	ReviewStatus    string `json:"review_status"`
	UpdatedAt       string `json:"updated_at"`
}
