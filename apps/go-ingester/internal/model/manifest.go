package model

import "fmt"

// PairStatus describes the pairing status of TPF + LC for a specific sample.
type PairStatus string

const (
	PairStatusPaired  PairStatus = "PAIRED"
	PairStatusTPFOnly PairStatus = "TPF_ONLY"
	PairStatusLCOnly  PairStatus = "LC_ONLY"
)

// ManifestProduct represents a selected product inside the ingestion manifest.
type ManifestProduct struct {
	SourceProductID string      `json:"source_product_id"`
	Kind            ProductKind `json:"kind"`
	Filename        string      `json:"filename"`
	DataURI         string      `json:"data_uri"`
	SizeBytes       int64       `json:"size_bytes"`
	Sector          int         `json:"sector"`
	TICID           int64       `json:"tic_id,omitempty"`
	Camera          int         `json:"camera,omitempty"`
	CCD             int         `json:"ccd,omitempty"`
}

// Sample represents a logical observation sample (TIC + Sector).
type Sample struct {
	SampleID    string           `json:"sample_id"`
	TICID       int64            `json:"tic_id"`
	Sector      int              `json:"sector"`
	PairStatus  PairStatus       `json:"pair_status"`
	TargetPixel *ManifestProduct `json:"target_pixel,omitempty"`
	LightCurve  *ManifestProduct `json:"light_curve,omitempty"`
}

// Statistics summarizes product counts and total volume selected in a manifest.
type Statistics struct {
	PairedCount  int   `json:"paired_count"`
	TPFOnlyCount int   `json:"tpf_only_count"`
	LCOnlyCount  int   `json:"lc_only_count"`
	FFICount     int   `json:"ffi_count"`
	TPFBytes     int64 `json:"tpf_bytes"`
	LCBytes      int64 `json:"lc_bytes"`
	FFIBytes     int64 `json:"ffi_bytes"`
	TotalBytes   int64 `json:"total_bytes"`
}

// Manifest represents the top-level deterministic AURORA ingestion plan.
type Manifest struct {
	SchemaVersion int               `json:"schema_version"`
	Source        string            `json:"source"`
	Samples       []Sample          `json:"samples"`
	FFIs          []ManifestProduct `json:"ffis,omitempty"`
	Statistics    Statistics        `json:"statistics"`
}

// SelectOptions defines constraints applied during product selection and manifest generation.
type SelectOptions struct {
	IncludeTPF    bool
	IncludeLC     bool
	IncludeFFI    bool
	RequirePair   bool
	MaxSamples    int
	MaxFFI        int
	MaxTotalBytes int64
}

// SampleID generates a deterministic sample identity string from TIC ID and Sector.
func SampleID(tic int64, sector int) string {
	return fmt.Sprintf("sample:tic=%d:sector=%04d", tic, sector)
}
