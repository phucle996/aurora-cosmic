package model

import "time"

// IngestStatus represents the ingestion and event publishing outcome for a single product.
type IngestStatus string

const (
	StatusStored            IngestStatus = "STORED"
	StatusSkipped           IngestStatus = "SKIPPED"
	StatusFailed            IngestStatus = "FAILED"
	StatusStoredEventFailed IngestStatus = "STORED_EVENT_FAILED"
	StatusPublished         IngestStatus = "PUBLISHED"
)

// ProductResult captures the detailed result of ingesting one product.
type ProductResult struct {
	SourceProductID string
	ObjectKey       string
	SizeBytes       int64
	SHA256          string
	Status          IngestStatus
	Error           error
}

// Summary collects overall metrics for a completed manifest ingestion run.
type Summary struct {
	PlannedProducts        int
	PublishedCount         int
	StoredCount            int
	SkippedCount           int
	FailedCount            int
	StoredEventFailedCount int
	StoredBytes            int64
	Elapsed                time.Duration
	ThroughputBps          float64
}
