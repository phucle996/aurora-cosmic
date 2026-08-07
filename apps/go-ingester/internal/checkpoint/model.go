package checkpoint

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"time"

	"go-ingester/internal/manifest"
	"go-ingester/internal/mast"
)

const SchemaVersion = 1

type ProductState string

const (
	StatePlanned     ProductState = "PLANNED"
	StateDownloading ProductState = "DOWNLOADING"
	StateStored      ProductState = "STORED"
	StatePublished   ProductState = "PUBLISHED"
	StateFailed      ProductState = "FAILED"
)

type RunStatus string

const (
	RunStatusRunning               RunStatus = "RUNNING"
	RunStatusCompleted             RunStatus = "COMPLETED"
	RunStatusCompletedWithFailures RunStatus = "COMPLETED_WITH_FAILURES"
)

// ProductCheckpoint tracks progress for an individual product.
type ProductCheckpoint struct {
	SourceProductID   string           `json:"source_product_id"`
	SampleID          string           `json:"sample_id,omitempty"`
	ProductKind       mast.ProductKind `json:"product_kind"`
	SourceURI         string           `json:"source_uri"`
	ObjectKey         string           `json:"object_key"`
	ExpectedSizeBytes int64            `json:"expected_size_bytes"`
	SizeBytes         int64            `json:"size_bytes,omitempty"`
	SHA256            string           `json:"sha256,omitempty"`
	State             ProductState     `json:"state"`
	Attempts          int              `json:"attempts"`
	LastError         string           `json:"last_error,omitempty"`
	Sector            int              `json:"sector,omitempty"`
	TICID             int64            `json:"tic_id,omitempty"`
	Camera            int              `json:"camera,omitempty"`
	CCD               int              `json:"ccd,omitempty"`
	UpdatedAt         time.Time        `json:"updated_at"`
}

// Checkpoint represents an entire ingestion run state.
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

// CurrentPointer is a lightweight reference stored at checkpoints/ingestion/current.json.
type CurrentPointer struct {
	RunID         string    `json:"run_id"`
	Status        RunStatus `json:"status"`
	CheckpointKey string    `json:"checkpoint_key"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// ComputeManifestHash computes SHA256 hash of manifest contents to identify manifest identity.
func ComputeManifestHash(m *manifest.Manifest) string {
	h := sha256.New()
	fmt.Fprintf(h, "schema=%d|source=%s|samples=%d|products=%d|bytes=%d",
		m.SchemaVersion, m.Source, m.Statistics.SampleCount, m.Statistics.ProductCount, m.Statistics.TotalBytes)
	for _, s := range m.Samples {
		if s.TargetPixel != nil {
			fmt.Fprintf(h, "|%s:%s:%d", s.TargetPixel.SourceProductID, s.TargetPixel.Filename, s.TargetPixel.SizeBytes)
		}
		if s.LightCurve != nil {
			fmt.Fprintf(h, "|%s:%s:%d", s.LightCurve.SourceProductID, s.LightCurve.Filename, s.LightCurve.SizeBytes)
		}
	}
	for _, f := range m.FFIs {
		fmt.Fprintf(h, "|%s:%s:%d", f.SourceProductID, f.Filename, f.SizeBytes)
	}
	return hex.EncodeToString(h.Sum(nil))
}
