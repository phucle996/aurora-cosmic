package model

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"
)

const (
	SchemaVersion = 1

	PointerKey = "checkpoints/ingestion/current.json"
)

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
	SourceProductID   string       `json:"source_product_id"`
	SampleID          string       `json:"sample_id,omitempty"`
	ProductKind       ProductKind  `json:"product_kind"`
	SourceURI         string       `json:"source_uri"`
	ObjectKey         string       `json:"object_key"`
	ExpectedSizeBytes int64        `json:"expected_size_bytes"`
	SizeBytes         int64        `json:"size_bytes,omitempty"`
	SHA256            string       `json:"sha256,omitempty"`
	State             ProductState `json:"state"`
	Attempts          int          `json:"attempts"`
	LastError         string       `json:"last_error,omitempty"`
	Sector            int          `json:"sector"`
	TICID             int64        `json:"tic_id,omitempty"`
	Camera            int          `json:"camera,omitempty"`
	CCD               int          `json:"ccd,omitempty"`
	UpdatedAt         time.Time    `json:"updated_at"`
}

// Checkpoint represents a versioned, durable ingestion run state document.
type Checkpoint struct {
	SchemaVersion int                           `json:"schema_version"`
	RunID         string                        `json:"run_id"`
	Status        RunStatus                     `json:"status"`
	ManifestPath  string                        `json:"manifest_path"`
	ManifestHash  string                        `json:"manifest_hash"`
	StartedAt     time.Time                     `json:"started_at"`
	UpdatedAt     time.Time                     `json:"updated_at"`
	Products      map[string]*ProductCheckpoint `json:"products"`
}

// CurrentPointer represents the pointer document stored at current.json.
type CurrentPointer struct {
	ActiveRunID   string    `json:"active_run_id"`
	ManifestPath  string    `json:"manifest_path"`
	ManifestHash  string    `json:"manifest_hash"`
	LastUpdatedAt time.Time `json:"last_updated_at"`
}

// RunKey returns the MinIO S3 object key for a specific run ID checkpoint.
func RunKey(runID string) string {
	return fmt.Sprintf("checkpoints/ingestion/runs/%s.json", runID)
}

// ComputeManifestHash computes a SHA256 checksum over the serialized manifest content.
func ComputeManifestHash(m *Manifest) string {
	b, err := json.Marshal(m)
	if err != nil {
		return ""
	}
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

// CreateNewInitialCheckpoint initializes a fresh Checkpoint struct from products list.
func CreateNewInitialCheckpoint(runID string, manifestPath string, manifestHash string, products []ManifestProduct) *Checkpoint {
	prodMap := make(map[string]*ProductCheckpoint, len(products))
	now := time.Now().UTC()

	for _, p := range products {
		key, _ := BuildObjectKey(p)
		sampleID := ""
		if p.TICID > 0 && p.Sector > 0 {
			sampleID = SampleID(p.TICID, p.Sector)
		}

		prodMap[p.SourceProductID] = &ProductCheckpoint{
			SourceProductID:   p.SourceProductID,
			SampleID:          sampleID,
			ProductKind:       p.Kind,
			SourceURI:         p.DataURI,
			ObjectKey:         key,
			ExpectedSizeBytes: p.SizeBytes,
			State:             StatePlanned,
			Attempts:          0,
			Sector:            p.Sector,
			TICID:             p.TICID,
			Camera:            p.Camera,
			CCD:               p.CCD,
			UpdatedAt:         now,
		}
	}

	return &Checkpoint{
		SchemaVersion: SchemaVersion,
		RunID:         runID,
		Status:        RunStatusRunning,
		ManifestPath:  manifestPath,
		ManifestHash:  manifestHash,
		StartedAt:     now,
		UpdatedAt:     now,
		Products:      prodMap,
	}
}
