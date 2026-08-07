package manifest

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	"go-ingester/internal/mast"
)

const SchemaVersion = 1

// PairStatus describes completeness of a TPF/LC observation pair.
type PairStatus string

const (
	PairStatusPaired  PairStatus = "PAIRED"
	PairStatusTPFOnly PairStatus = "TPF_ONLY"
	PairStatusLCOnly  PairStatus = "LC_ONLY"
)

// Manifest is the top-level ingestion plan produced by Phase 2.2.
type Manifest struct {
	SchemaVersion int              `json:"schema_version"`
	CreatedAt     time.Time        `json:"created_at"`
	Source        string           `json:"source"`
	Statistics    Statistics       `json:"statistics"`
	Samples       []Sample         `json:"samples"`
	FFIs          []ManifestProduct `json:"ffi"`
}

// Statistics summarises what the manifest contains.
type Statistics struct {
	SampleCount   int   `json:"sample_count"`
	PairedCount   int   `json:"paired_count"`
	TPFOnlyCount  int   `json:"tpf_only_count"`
	LCOnlyCount   int   `json:"lc_only_count"`
	FFICount      int   `json:"ffi_count"`
	ProductCount  int   `json:"product_count"`
	TotalBytes    int64 `json:"total_size_bytes"`
	TPFBytes      int64 `json:"tpf_size_bytes"`
	LCBytes       int64 `json:"lc_size_bytes"`
	FFIBytes      int64 `json:"ffi_size_bytes"`
}

// Sample represents one paired (or partial) TESS target observation.
type Sample struct {
	SampleID    string     `json:"sample_id"`
	TICID       int64      `json:"tic_id"`
	Sector      int        `json:"sector"`
	PairStatus  PairStatus `json:"pair_status"`
	TargetPixel *ManifestProduct `json:"target_pixel,omitempty"`
	LightCurve  *ManifestProduct `json:"light_curve,omitempty"`
}

// ManifestProduct is a single FITS file entry in the manifest.
type ManifestProduct struct {
	SourceProductID  string           `json:"source_product_id"`
	ObsID            string           `json:"obs_id"`
	Kind             mast.ProductKind `json:"product_kind"`
	Filename         string           `json:"filename"`
	DataURI          string           `json:"data_uri"`
	SizeBytes        int64            `json:"size_bytes"`
	Sector           int              `json:"sector,omitempty"`
	TICID            int64            `json:"tic_id,omitempty"`
	Camera           int              `json:"camera,omitempty"`
	CCD              int              `json:"ccd,omitempty"`
	CalibrationLevel int              `json:"calibration_level,omitempty"`
	SourceVersion    string           `json:"source_version,omitempty"`
}

// SampleKey is the pairing identity for a TESS target observation.
type SampleKey struct {
	TICID  int64
	Sector int
}

// SampleID returns a stable, human-readable identifier for the sample.
//
//	tess-tic-123456789-sector-0042
func SampleID(ticID int64, sector int) string {
	return fmt.Sprintf("tess-tic-%d-sector-%04d", ticID, sector)
}

// ComputeStatistics derives Statistics from the finalised manifest content.
func ComputeStatistics(samples []Sample, ffis []ManifestProduct) Statistics {
	s := Statistics{
		SampleCount: len(samples),
		FFICount:    len(ffis),
	}
	for _, ff := range ffis {
		s.FFIBytes += ff.SizeBytes
		s.ProductCount++
	}
	for _, sm := range samples {
		switch sm.PairStatus {
		case PairStatusPaired:
			s.PairedCount++
		case PairStatusTPFOnly:
			s.TPFOnlyCount++
		case PairStatusLCOnly:
			s.LCOnlyCount++
		}
		if sm.TargetPixel != nil {
			s.TPFBytes += sm.TargetPixel.SizeBytes
			s.ProductCount++
		}
		if sm.LightCurve != nil {
			s.LCBytes += sm.LightCurve.SizeBytes
			s.ProductCount++
		}
	}
	s.TotalBytes = s.TPFBytes + s.LCBytes + s.FFIBytes
	return s
}

// ParseTICFromTarget attempts to extract a TIC ID from a TESS target_name
// such as "TIC 123456789" or "123456789". Returns 0 if not parseable.
func ParseTICFromTarget(targetName string) int64 {
	s := strings.TrimSpace(strings.TrimPrefix(strings.ToUpper(targetName), "TIC"))
	s = strings.TrimSpace(s)
	id, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return 0
	}
	return id
}

// ParseSectorFromObsID tries to extract a sector number from a TESS obs_id
// such as "tess2019357164649-s0007-0000000349376986-0138-s". Returns 0 on failure.
func ParseSectorFromObsID(obsID string) int {
	// Canonical TESS obs_id format includes "-s<NNNN>-" segment.
	parts := strings.Split(strings.ToLower(obsID), "-")
	for _, p := range parts {
		if strings.HasPrefix(p, "s") && len(p) == 5 {
			n, err := strconv.Atoi(p[1:])
			if err == nil && n > 0 {
				return n
			}
		}
	}
	return 0
}
