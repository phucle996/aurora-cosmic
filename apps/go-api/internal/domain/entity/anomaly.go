package entity

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
