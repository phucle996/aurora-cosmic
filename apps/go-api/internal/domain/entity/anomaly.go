package entity

type Anomaly struct {
	PredictionID      string  `json:"prediction_id" ch:"prediction_id"`
	SourceProductID   string  `json:"source_product_id" ch:"source_product_id"`
	TICID             int64   `json:"tic_id" ch:"tic_id"`
	Sector            int32   `json:"sector" ch:"sector"`
	ReconstructionMSE float64 `json:"reconstruction_mse" ch:"reconstruction_mse"`
	Threshold         float64 `json:"decision_threshold" ch:"decision_threshold"`
	AboveThreshold    bool    `json:"above_threshold" ch:"above_threshold"`
	ModelVersion      string  `json:"model_version" ch:"model_version"`
	RegisteredModel   string  `json:"registered_model_id" ch:"registered_model_id"`
	SnapshotID        string  `json:"gold_snapshot_id" ch:"gold_snapshot_id"`
	ValidationID      string  `json:"runtime_validation_id" ch:"runtime_validation_id"`
	RuntimePkgID      string  `json:"runtime_package_id" ch:"runtime_package_id"`
	PredictedAt       string  `json:"predicted_at" ch:"predicted_at"`
}

type AnomalyDetail struct {
	Anomaly              Anomaly             `json:"anomaly"`
	ExplanationAvailable bool                `json:"explanation_available"`
	Explanation          *AnomalyExplanation `json:"explanation"`
	SnapshotID           string              `json:"snapshot_id,omitempty"`
}

type AnomalyListResponse struct {
	Task        string       `json:"task"`
	Count       int          `json:"count"`
	Anomalies   []Anomaly    `json:"anomalies"`
	Page        PageMetadata `json:"page"`
	SnapshotID  string       `json:"snapshot_id"`
	OnlyFlagged bool         `json:"only_flagged"`
}

type AnomalyExplanation struct {
	SchemaVersion        int64                       `json:"schema_version"`
	ExplanationVersion   string                      `json:"explanation_version"`
	PredictionID         string                      `json:"prediction_id"`
	GoldSnapshotID       string                      `json:"gold_snapshot_id"`
	GoldArtifactKey      string                      `json:"gold_artifact_key"`
	SourceProductID      string                      `json:"source_product_id"`
	TICID                int64                       `json:"tic_id"`
	SampleID             *string                     `json:"sample_id"`
	Sector               int64                       `json:"sector"`
	RuntimePackageID     string                      `json:"runtime_package_id"`
	RuntimeValidationID  string                      `json:"runtime_validation_id"`
	RegisteredModelID    string                      `json:"registered_model_id"`
	ModelVersion         string                      `json:"model_version"`
	PreprocessingVersion string                      `json:"preprocessing_version"`
	SplitID              string                      `json:"split_id"`
	FeatureOrder         []string                    `json:"feature_order"`
	ModelInputSHA256     string                      `json:"model_input_sha256"`
	ReconstructionMSE    float64                     `json:"reconstruction_mse"`
	DecisionThreshold    float64                     `json:"decision_threshold"`
	AboveThreshold       bool                        `json:"above_threshold"`
	Features             []AnomalyExplanationFeature `json:"features"`
}

type AnomalyExplanationFeature struct {
	Name              string   `json:"name"`
	GoldValue         *float64 `json:"gold_value"`
	ModelValue        float64  `json:"model_value"`
	Imputed           bool     `json:"imputed"`
	Mean              float64  `json:"mean"`
	Scale             float64  `json:"scale"`
	StandardizedInput float64  `json:"standardized_input"`
	Reconstruction    float64  `json:"reconstruction"`
	Residual          float64  `json:"residual"`
	SquaredResidual   float64  `json:"squared_residual"`
	Contribution      float64  `json:"contribution"`
}
