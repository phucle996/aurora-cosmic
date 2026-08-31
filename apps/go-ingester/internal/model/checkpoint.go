package model

import "time"

// ProductState represents the progression state of a product in the checkpoint lifecycle.
type ProductState string

const (
	StatePlanned     ProductState = "PLANNED"
	StateDownloading ProductState = "DOWNLOADING"
	StateStored      ProductState = "STORED"
	StatePublished   ProductState = "PUBLISHED"
	StateFailed      ProductState = "FAILED"
)

// RunStatus represents the overall completion state of an ingestion run.
type RunStatus string

const (
	RunStatusRunning               RunStatus = "RUNNING"
	RunStatusCompleted             RunStatus = "COMPLETED"
	RunStatusCompletedWithFailures RunStatus = "COMPLETED_WITH_FAILURES"
	RunStatusFailed                RunStatus = "FAILED"
)

// ProductCheckpoint tracks execution state, attempt counts, and hashes for a single product.
type ProductCheckpoint struct {
	SourceProductID   string
	SampleID          string
	ProductKind       ProductKind
	SourceURI         string
	ObjectKey         string
	ExpectedSizeBytes int64
	SizeBytes         int64
	SHA256            string
	State             ProductState
	Attempts          int
	LastError         string
	Sector            int
	TICID             int64
	Camera            int
	CCD               int
	UpdatedAt         time.Time
}

// Checkpoint represents a versioned, durable ingestion run state document.
type Checkpoint struct {
	SchemaVersion int
	RunID         string
	Status        RunStatus
	ManifestPath  string
	ManifestHash  string
	StartedAt     time.Time
	UpdatedAt     time.Time
	Products      map[string]*ProductCheckpoint
}

// CurrentPointer represents the pointer document stored at current.json.
type CurrentPointer struct {
	ActiveRunID   string
	ManifestPath  string
	ManifestHash  string
	LastUpdatedAt time.Time
}
