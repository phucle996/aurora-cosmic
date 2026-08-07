package ingest

import (
	"crypto/sha256"
	"encoding/hex"
	"hash"
	"io"
	"time"
)

// Status represents the ingestion and event publishing outcome for a single product.
type Status string

const (
	StatusStored            Status = "STORED"
	StatusSkipped           Status = "SKIPPED"
	StatusFailed            Status = "FAILED"
	StatusStoredEventFailed Status = "STORED_EVENT_FAILED"
	StatusPublished         Status = "PUBLISHED"
)

// ProductResult captures the detailed result of ingesting one product.
type ProductResult struct {
	SourceProductID string
	ObjectKey       string
	SizeBytes       int64
	SHA256          string
	Status          Status
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

// hashedReader wraps an io.Reader, computing SHA256 and tracking byte count on the fly.
type hashedReader struct {
	r         io.Reader
	h         hash.Hash
	bytesRead int64
}

func newHashedReader(r io.Reader) *hashedReader {
	return &hashedReader{
		r: r,
		h: sha256.New(),
	}
}

func (hr *hashedReader) Read(p []byte) (int, error) {
	n, err := hr.r.Read(p)
	if n > 0 {
		hr.h.Write(p[:n])
		hr.bytesRead += int64(n)
	}
	return n, err
}

func (hr *hashedReader) BytesRead() int64 {
	return hr.bytesRead
}

func (hr *hashedReader) SumHex() string {
	return hex.EncodeToString(hr.h.Sum(nil))
}
