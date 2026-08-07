package model

import (
	"context"
	"fmt"
	"time"
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

// Publisher defines the interface for publishing Bronze object readiness events to NATS JetStream.
type Publisher interface {
	PublishBronzeReady(ctx context.Context, evt *BronzeObjectReady) error
	Close() error
}

// SubjectForKind maps ProductKind to its designated NATS subject.
func SubjectForKind(kind ProductKind) (string, error) {
	switch kind {
	case KindTargetPixel:
		return SubjectBronzeTargetPixel, nil
	case KindLightCurve:
		return SubjectBronzeLightCurve, nil
	case KindFFI:
		return SubjectBronzeFFI, nil
	default:
		return "", fmt.Errorf("events: unknown product kind %q", kind)
	}
}

// BuildBronzeEvent constructs a validated BronzeObjectReady event struct.
func BuildBronzeEvent(eventID, bucket string, prod ManifestProduct, objectKey, sha256 string) (*BronzeObjectReady, error) {
	if eventID == "" {
		return nil, fmt.Errorf("events: eventID cannot be empty")
	}
	if bucket == "" {
		return nil, fmt.Errorf("events: bucket cannot be empty")
	}
	if objectKey == "" {
		return nil, fmt.Errorf("events: objectKey cannot be empty")
	}
	if sha256 == "" {
		return nil, fmt.Errorf("events: sha256 checksum cannot be empty")
	}

	sampleID := ""
	if prod.TICID > 0 && prod.Sector > 0 {
		sampleID = SampleID(prod.TICID, prod.Sector)
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
		SHA256:          sha256,
	}, nil
}
