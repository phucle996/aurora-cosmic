package entity

import "time"

type IngestProduct struct {
	ID        string
	Kind      string
	ObjectKey string
	State     string
	SizeBytes int64
	Expected  int64
	Attempts  int
	LastError string
	UpdatedAt time.Time
}

type IngestKindSummary struct {
	Planned     int `json:"planned"`
	Completed   int `json:"completed"`
	Downloading int `json:"downloading"`
	Failed      int `json:"failed"`
}

type IngestCatalogProgress struct {
	State       string `json:"state"`
	Stage       string `json:"stage"`
	TICRows     int    `json:"tic_rows"`
	TOIRows     int    `json:"toi_rows"`
	Completed   int    `json:"completed"`
	Total       int    `json:"total"`
	SnapshotTIC string `json:"tic_snapshot_id,omitempty"`
	SnapshotTOI string `json:"toi_snapshot_id,omitempty"`
	Error       string `json:"error,omitempty"`
}

type IngestManifestProgress struct {
	State              string            `json:"state"`
	Stage              string            `json:"stage"`
	Completed          int               `json:"completed"`
	Total              int               `json:"total"`
	StageCompleted     int               `json:"stage_completed,omitempty"`
	StageTotal         int               `json:"stage_total,omitempty"`
	DiscoveredProducts int               `json:"discovered_products"`
	PairedSamples      int               `json:"paired_samples"`
	SelectedSamples    int               `json:"selected_samples"`
	PrioritySamples    int               `json:"priority_samples"`
	CatalogSnapshots   map[string]string `json:"catalog_snapshots,omitempty"`
	Error              string            `json:"error,omitempty"`
	UpdatedAt          time.Time         `json:"updated_at"`
}

type IngestStatus struct {
	Observed          bool
	Source            string
	RunID             string
	ControlJobID      string
	Status            string
	Error             string
	ManifestPath      string
	StartedAt         time.Time
	UpdatedAt         time.Time
	TotalProducts     int
	CompletedProducts int
	Downloading       int
	FailedProducts    int
	ExpectedBytes     int64
	CompletedBytes    int64
	ProductsPerSecond float64
	BytesPerSecond    float64
	QueueDepth        float64
	InflightProducts  float64
	ObservedAt        time.Time
	Products          []IngestProduct
	ProductsTruncated bool
	ProductKinds      map[string]IngestKindSummary
	CatalogProgress   *IngestCatalogProgress
	ManifestProgress  *IngestManifestProgress
}

type IngestStartRequest struct {
	ManifestPath string
	Sector       int
	Limit        int
	Concurrency  int
	Resume       bool
	Fresh        bool
}

type IngestControlJob struct {
	JobID        string
	Status       string
	ManifestPath string
	Sector       int
	Concurrency  int
	StartedAt    time.Time
	UpdatedAt    time.Time
	Error        string
}

type StorageObject struct {
	Key          string
	SizeBytes    int64
	ETag         string
	LastModified time.Time
}

type StorageListing struct {
	Bucket     string
	Prefix     string
	Page       int
	PageSize   int
	Total      int
	TotalBytes int64
	Truncated  bool
	Objects    []StorageObject
}
