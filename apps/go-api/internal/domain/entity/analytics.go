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
}

type Target struct {
	TICID       int64
	TessMag     float64
	RA          float64
	Dec         float64
	EffectiveT  float64
	SurfaceGrav float64
	Radius      float64
	Sector      int
	TOI         string
	Disposition string
}

type Lightcurve struct {
	TICID int64
	Time  []float64
	Flux  []float64
}
