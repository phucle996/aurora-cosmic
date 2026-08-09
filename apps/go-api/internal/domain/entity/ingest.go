package entity

import "time"

type IngestProduct struct {
	ID        string    `json:"id"`
	Kind      string    `json:"kind"`
	ObjectKey string    `json:"object_key"`
	State     string    `json:"state"`
	SizeBytes int64     `json:"size_bytes"`
	Expected  int64     `json:"expected_size_bytes"`
	Attempts  int       `json:"attempts"`
	LastError string    `json:"last_error,omitempty"`
	UpdatedAt time.Time `json:"updated_at"`
}

type IngestStatus struct {
	Observed          bool            `json:"observed"`
	Source            string          `json:"source"`
	RunID             string          `json:"run_id,omitempty"`
	Status            string          `json:"status"`
	ManifestPath      string          `json:"manifest_path,omitempty"`
	StartedAt         time.Time       `json:"started_at,omitempty"`
	UpdatedAt         time.Time       `json:"updated_at,omitempty"`
	TotalProducts     int             `json:"total_products"`
	CompletedProducts int             `json:"completed_products"`
	Downloading       int             `json:"downloading"`
	FailedProducts    int             `json:"failed_products"`
	ExpectedBytes     int64           `json:"expected_bytes"`
	CompletedBytes    int64           `json:"completed_bytes"`
	ProductsPerSecond float64         `json:"products_per_second"`
	BytesPerSecond    float64         `json:"bytes_per_second"`
	QueueDepth        float64         `json:"queue_depth"`
	InflightProducts  float64         `json:"inflight_products"`
	ObservedAt        time.Time       `json:"observed_at"`
	Products          []IngestProduct `json:"products,omitempty"`
}

type IngestStartRequest struct {
	ManifestPath string `json:"manifest_path,omitempty"`
	Sector       int    `json:"sector,omitempty"`
	Limit        int    `json:"limit,omitempty"`
	Concurrency  int    `json:"concurrency,omitempty"`
	Resume       bool   `json:"resume,omitempty"`
	Fresh        bool   `json:"fresh,omitempty"`
}

type IngestControlJob struct {
	JobID        string    `json:"job_id"`
	Status       string    `json:"status"`
	ManifestPath string    `json:"manifest_path,omitempty"`
	Sector       int       `json:"sector,omitempty"`
	StartedAt    time.Time `json:"started_at"`
	UpdatedAt    time.Time `json:"updated_at"`
	Error        string    `json:"error,omitempty"`
}

type StorageObject struct {
	Key          string    `json:"key"`
	SizeBytes    int64     `json:"size_bytes"`
	ETag         string    `json:"etag,omitempty"`
	LastModified time.Time `json:"last_modified"`
}

type StorageListing struct {
	Bucket    string          `json:"bucket"`
	Prefix    string          `json:"prefix"`
	Total     int             `json:"total"`
	Truncated bool            `json:"truncated"`
	Objects   []StorageObject `json:"objects"`
}
