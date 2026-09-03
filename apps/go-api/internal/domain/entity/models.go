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

// EvaluationCohortMetrics is measured classifier evidence for one immutable
// evaluation cohort. Pointer-valued scores preserve the distinction between a
// measured zero and a metric that was not emitted by the evaluator.
type EvaluationCohortMetrics struct {
	RowCount        int64     `json:"row_count"`
	PositiveCount   int64     `json:"positive_count"`
	NegativeCount   int64     `json:"negative_count"`
	PRAUC           *float64  `json:"pr_auc,omitempty"`
	ROCAUC          *float64  `json:"roc_auc,omitempty"`
	Precision       *float64  `json:"precision,omitempty"`
	Recall          *float64  `json:"recall,omitempty"`
	F1              *float64  `json:"f1,omitempty"`
	ConfusionMatrix [][]int64 `json:"confusion_matrix,omitempty"`
}

// ModelEvaluation is the durable, read-only evidence bound to one runtime
// package. The API reads it from the evaluator artifacts in object storage.
type ModelEvaluation struct {
	RuntimePackageID         string                   `json:"runtime_package_id"`
	ModelID                  string                   `json:"model_id"`
	ModelVersion             string                   `json:"model_version"`
	Task                     string                   `json:"task"`
	ModelStatus              string                   `json:"model_status"`
	ParityStatus             string                   `json:"parity_status"`
	IntegrityStatus          string                   `json:"integrity_status"`
	EvaluationRunID          string                   `json:"evaluation_run_id"`
	TrainingRunID            string                   `json:"training_run_id"`
	GoldSnapshotID           string                   `json:"gold_snapshot_id,omitempty"`
	GoldManifestSHA256       string                   `json:"gold_manifest_sha256,omitempty"`
	SplitID                  string                   `json:"split_id,omitempty"`
	DatasetViewVersion       string                   `json:"dataset_view_version,omitempty"`
	DatasetViewFingerprint   string                   `json:"dataset_view_fingerprint,omitempty"`
	TrainingManifestSHA256   string                   `json:"training_run_manifest_sha256,omitempty"`
	EvaluationManifestSHA256 string                   `json:"evaluation_run_manifest_sha256,omitempty"`
	GoldenCohortID           string                   `json:"golden_cohort_id"`
	RecentCohortID           string                   `json:"recent_cohort_id,omitempty"`
	EvaluationPolicy         string                   `json:"evaluation_policy_version"`
	ThresholdPolicy          string                   `json:"threshold_policy_version"`
	DecisionThreshold        float64                  `json:"decision_threshold"`
	ValidationRowCount       int64                    `json:"validation_row_count"`
	ValidationPrecision      *float64                 `json:"validation_precision,omitempty"`
	ValidationRecall         *float64                 `json:"validation_recall,omitempty"`
	ValidationF1             *float64                 `json:"validation_f1,omitempty"`
	Golden                   EvaluationCohortMetrics  `json:"golden"`
	Recent                   *EvaluationCohortMetrics `json:"recent,omitempty"`
	PRAUCDrift               *float64                 `json:"pr_auc_drift,omitempty"`
	RecallDrift              *float64                 `json:"recall_drift,omitempty"`
	EvaluationManifestKey    string                   `json:"evaluation_manifest_key"`
	RuntimeManifestKey       string                   `json:"runtime_manifest_key"`
	PreprocessingVersion     string                   `json:"preprocessing_version"`
	FeatureCount             int                      `json:"feature_count"`
	ONNXSizeBytes            int64                    `json:"onnx_size_bytes"`
	ONNXSHA256               string                   `json:"onnx_sha256"`
	MetricsSHA256            string                   `json:"metrics_sha256"`
	CreatedAt                string                   `json:"created_at"`
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
	OutputSHA256            string
	ProcessedRows           int64
	Attempt                 int64
	StartedAt               string
	UpdatedAt               string
	Error                   string
	Producer                string
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

// ModelDeploymentResult is the observed evidence returned after a promotion
// canary passes and the serving pointer is committed.
type ModelDeploymentResult struct {
	TicketID          string  `json:"ticket_id"`
	RuntimePackageID  string  `json:"runtime_package_id"`
	RuntimeValidation string  `json:"runtime_validation_id,omitempty"`
	Engine            string  `json:"engine,omitempty"`
	MaxAbsoluteError  float64 `json:"max_absolute_error,omitempty"`
	MaxRelativeError  float64 `json:"max_relative_error,omitempty"`
	Active            bool    `json:"active"`
}

// TrainingReadiness is the measured supervised-label coverage for an immutable
// set of Candidate Gold snapshots. Candidate discovery rows may be unlabelled;
// they must never be silently treated as negative examples for model training.
type TrainingReadiness struct {
	SnapshotID                                string   `json:"snapshot_id,omitempty"`
	SnapshotIDs                               []string `json:"snapshot_ids"`
	TotalRows                                 int64    `json:"total_rows"`
	PositiveRows                              int64    `json:"positive_rows"`
	NegativeRows                              int64    `json:"negative_rows"`
	UnresolvedRows                            int64    `json:"unresolved_rows"`
	PositiveTargets                           int64    `json:"positive_targets"`
	NegativeTargets                           int64    `json:"negative_targets"`
	Ready                                     bool     `json:"ready"`
	Tier                                      string   `json:"tier"`
	PolicyVersion                             string   `json:"policy_version"`
	ExperimentalMinimumPositiveTargets        int64    `json:"experimental_minimum_positive_targets"`
	ExperimentalMinimumNegativeTargets        int64    `json:"experimental_minimum_negative_targets"`
	ProductionCandidateMinimumPositiveTargets int64    `json:"production_candidate_minimum_positive_targets"`
	ProductionCandidateMinimumNegativeTargets int64    `json:"production_candidate_minimum_negative_targets"`
	NegativeDiversityTarget                   int64    `json:"negative_diversity_target"`
	NegativeDiversityTargetMet                bool     `json:"negative_diversity_target_met"`
	Blocker                                   string   `json:"blocker,omitempty"`
}

// TrainingLabelOverride is a human-reviewed correction to the derived cohort.
// It never changes the immutable Candidate Gold row.
type TrainingLabelOverride struct {
	SnapshotID      string
	SourceProductID string
	TrainingLabel   string
	ReviewReason    string
	Confidence      float64
}

// TrainingReview is one durable human decision in the mutable training cohort.
type TrainingReview struct {
	SnapshotID      string  `json:"snapshot_id"`
	SourceProductID string  `json:"source_product_id"`
	TICID           int64   `json:"tic_id"`
	Sector          int     `json:"sector"`
	TrainingLabel   string  `json:"training_label"`
	ReviewStatus    string  `json:"review_status"`
	ReviewReason    string  `json:"review_reason"`
	Confidence      float64 `json:"confidence"`
	UpdatedAt       string  `json:"updated_at"`
}

// TrainingReviewEvidence contains the measured Gold evidence needed to make a
// human cohort decision without requiring an inference result.
type TrainingReviewEvidence struct {
	NPoints                  int64   `json:"n_points"`
	TimeSpanDays             float64 `json:"time_span_days"`
	SectorBaselineDays       float64 `json:"sector_baseline_days"`
	SectorCoveragePercent    float64 `json:"sector_coverage_percent"`
	LargestGapHours          float64 `json:"largest_gap_hours"`
	MedianCadenceMinutes     float64 `json:"median_cadence_minutes"`
	FluxStdPPM               float64 `json:"flux_std_ppm"`
	FluxAmplitudePPM         float64 `json:"flux_amplitude_ppm"`
	MedianFluxErrPPM         float64 `json:"median_flux_err_ppm"`
	BLSAvailable             bool    `json:"bls_available"`
	BLSPeriodDays            float64 `json:"bls_period_days"`
	BLSDurationHours         float64 `json:"bls_duration_hours"`
	BLSTransitTimeBTJD       float64 `json:"bls_transit_time_btjd"`
	BLSDepthPPM              float64 `json:"bls_depth_ppm"`
	BLSPower                 float64 `json:"bls_power"`
	VariabilityPeakFraction  float64 `json:"variability_peak_fraction"`
	TransitEvidenceAvailable bool    `json:"transit_evidence_available"`
	TransitDeficitSum        float64 `json:"transit_deficit_sum"`
	CentroidOffsetPixels     float64 `json:"centroid_offset_pixels"`
	TOIMatchStatus           string  `json:"toi_match_status"`
	MatchedTOIID             string  `json:"matched_toi_id"`
}

// TrainingModelSuggestion is optional. Absence means no deployed/inference
// model has produced a prediction for this exact immutable Gold row yet.
type TrainingModelSuggestion struct {
	CandidateScore   float64 `json:"candidate_score"`
	Threshold        float64 `json:"decision_threshold"`
	AboveThreshold   bool    `json:"above_threshold"`
	ModelID          string  `json:"model_id"`
	ModelVersion     string  `json:"model_version"`
	RuntimePackageID string  `json:"runtime_package_id"`
	PredictedAt      string  `json:"predicted_at"`
}

type TrainingReviewQueueItem struct {
	SnapshotID      string                   `json:"snapshot_id"`
	SourceProductID string                   `json:"source_product_id"`
	TICID           int64                    `json:"tic_id"`
	Sector          int                      `json:"sector"`
	TrainingLabel   string                   `json:"training_label"`
	LabelSource     string                   `json:"label_source"`
	ReviewStatus    string                   `json:"review_status"`
	ReviewReason    string                   `json:"review_reason,omitempty"`
	Confidence      float64                  `json:"confidence"`
	PolicyVersion   string                   `json:"policy_version"`
	Evidence        TrainingReviewEvidence   `json:"evidence"`
	ModelSuggestion *TrainingModelSuggestion `json:"model_suggestion,omitempty"`
}
