package model

import (
	"crypto/sha256"
	"encoding/hex"
	"hash"
	"io"
	"time"
)

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

// HashedReader wraps an io.Reader, computing SHA256 and tracking byte count on the fly.
type HashedReader struct {
	r         io.Reader
	h         hash.Hash
	bytesRead int64
}

func NewHashedReader(r io.Reader) *HashedReader {
	return &HashedReader{
		r: r,
		h: sha256.New(),
	}
}

func (hr *HashedReader) Read(p []byte) (int, error) {
	n, err := hr.r.Read(p)
	if n > 0 {
		hr.h.Write(p[:n])
		hr.bytesRead += int64(n)
	}
	return n, err
}

func (hr *HashedReader) BytesRead() int64 {
	return hr.bytesRead
}

func (hr *HashedReader) SumHex() string {
	return hex.EncodeToString(hr.h.Sum(nil))
}
