package entity

type PredictionProjectionResult struct {
	SourceEventID string
	JobID         string
	TicketID      string
	OutputKey     string
	ExpectedRows  int64
	InsertedRows  int64
}

type CandidatePredictionProjection struct {
	PredictionID      string  `json:"prediction_id" ch:"prediction_id"`
	SourceProductID   string  `json:"source_product_id" ch:"source_product_id"`
	TICID             int64   `json:"tic_id" ch:"tic_id"`
	Sector            int64   `json:"sector" ch:"sector"`
	RawLogit          float64 `json:"raw_logit" ch:"raw_logit"`
	CandidateScore    float64 `json:"candidate_score" ch:"candidate_score"`
	DecisionThreshold float64 `json:"decision_threshold" ch:"decision_threshold"`
	AboveThreshold    bool    `json:"above_threshold" ch:"above_threshold"`
	ModelVersion      string  `json:"model_version" ch:"model_version"`
	RegisteredModelID string  `json:"registered_model_id" ch:"registered_model_id"`
	GoldSnapshotID    string  `json:"gold_snapshot_id" ch:"gold_snapshot_id"`
	RuntimeValidation string  `json:"runtime_validation_id" ch:"runtime_validation_id"`
	RuntimePackageID  string  `json:"runtime_package_id" ch:"runtime_package_id"`
	PredictedAt       string  `json:"predicted_at" ch:"predicted_at"`
}
