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
