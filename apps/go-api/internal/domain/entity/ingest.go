package entity

import (
	"errors"
	"time"
)

var (
	ErrIngestAlreadyRunning = errors.New("an ingest job is already running")
	ErrIngestJobNotFound    = errors.New("ingest job not found")
)

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
	RunID             string
	TicketID          string
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
	QueueDepth        int
	InflightProducts  int
	ObservedAt        time.Time
	Products          []IngestProduct
	ProductsTruncated bool
	ProductKinds      map[string]IngestKindSummary
	CatalogProgress   *IngestCatalogProgress
	ManifestProgress  *IngestManifestProgress
}

type IngestStartRequest struct {
	TicketID     string `json:"ticket_id"`
	ManifestPath string `json:"manifest_path"`
	Sector       int    `json:"sector"`
	Limit        int    `json:"limit"`
	Concurrency  int    `json:"concurrency"`
	Resume       bool   `json:"resume"`
	Fresh        bool   `json:"fresh"`
}

type IngestControlJob struct {
	TicketID     string    `json:"ticket_id"`
	Status       string    `json:"status"`
	ManifestPath string    `json:"manifest_path"`
	Sector       int       `json:"sector"`
	Concurrency  int       `json:"concurrency"`
	StartedAt    time.Time `json:"started_at"`
	UpdatedAt    time.Time `json:"updated_at"`
	Error        string    `json:"error,omitempty"`
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
	Limit      int
	Cursor     string
	NextCursor string
	Page       int
	PageSize   int
	Total      int
	TotalBytes int64
	Truncated  bool
	Objects    []StorageObject
}
