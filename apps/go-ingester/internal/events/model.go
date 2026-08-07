package events

import (
	"fmt"
	"time"

	"go-ingester/internal/manifest"
	"go-ingester/internal/mast"
)

const (
	EventTypeBronzeObjectReady = "bronze.object.ready"

	SubjectBronzeTargetPixel = "aurora.v1.bronze.target-pixel.ready"
	SubjectBronzeLightCurve  = "aurora.v1.bronze.lightcurve.ready"
	SubjectBronzeFFI         = "aurora.v1.bronze.ffi.ready"

	StreamBronze = "AURORA_BRONZE"
)

// BronzeObjectReady represents the event payload defined in bronze-object-ready.schema.json.
type BronzeObjectReady struct {
	EventID         string    `json:"event_id"`
	EventType       string    `json:"event_type"`
	OccurredAt      time.Time `json:"occurred_at"`
	SourceProductID string    `json:"source_product_id"`
	SampleID        string    `json:"sample_id,omitempty"`
	ProductKind     string    `json:"product_kind"`
	Bucket          string    `json:"bucket"`
	ObjectKey       string    `json:"object_key"`
	Sector          int       `json:"sector"`
	TICID           int64     `json:"tic_id,omitempty"`
	Camera          int       `json:"camera,omitempty"`
	CCD             int       `json:"ccd,omitempty"`
	SizeBytes       int64     `json:"size_bytes"`
	SHA256          string    `json:"sha256"`
}

// SubjectForKind maps ProductKind to its designated NATS subject.
func SubjectForKind(kind mast.ProductKind) (string, error) {
	switch kind {
	case mast.KindTargetPixel:
		return SubjectBronzeTargetPixel, nil
	case mast.KindLightCurve:
		return SubjectBronzeLightCurve, nil
	case mast.KindFFI:
		return SubjectBronzeFFI, nil
	default:
		return "", fmt.Errorf("events: unknown product kind %q", kind)
	}
}

// BuildBronzeEvent constructs a BronzeObjectReady event struct.
func BuildBronzeEvent(eventID string, bucket string, prod manifest.ManifestProduct, objectKey string, sha256Hex string) (*BronzeObjectReady, error) {
	if eventID == "" {
		return nil, fmt.Errorf("events: missing event_id")
	}
	if objectKey == "" {
		return nil, fmt.Errorf("events: missing object_key")
	}
	if sha256Hex == "" {
		return nil, fmt.Errorf("events: missing sha256")
	}

	sampleID := ""
	if prod.TICID > 0 && prod.Sector > 0 {
		sampleID = manifest.SampleID(prod.TICID, prod.Sector)
	}

	return &BronzeObjectReady{
		EventID:         eventID,
		EventType:       EventTypeBronzeObjectReady,
		OccurredAt:      time.Now().UTC(),
		SourceProductID: prod.SourceProductID,
		SampleID:        sampleID,
		ProductKind:     string(prod.Kind),
		Bucket:          bucket,
		ObjectKey:       objectKey,
		Sector:          prod.Sector,
		TICID:           prod.TICID,
		Camera:          prod.Camera,
		CCD:             prod.CCD,
		SizeBytes:       prod.SizeBytes,
		SHA256:          sha256Hex,
	}, nil
}
