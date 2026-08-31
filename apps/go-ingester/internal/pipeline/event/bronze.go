// Package event owns Bronze readiness event construction and its publisher
// port. NATS serialization belongs in infra/events.
package event

import (
	"context"
	"fmt"
	"time"

	"go-ingester/internal/model"
	"go-ingester/internal/pipeline/plan"
)

const (
	TypeBronzeObjectReady = "bronze.object.ready"
	SubjectTargetPixel    = "aurora.v1.bronze.target-pixel.ready"
	SubjectLightCurve     = "aurora.v1.bronze.lightcurve.ready"
	StreamBronze          = "AURORA_BRONZE"
	StreamSilver          = "AURORA_SILVER"
)

type BronzeReady struct {
	EventID         string
	EventType       string
	OccurredAt      time.Time
	SourceProductID string
	SampleID        string
	ProductKind     string
	Bucket          string
	ObjectKey       string
	Sector          int
	TICID           int64
	Camera          int
	CCD             int
	SizeBytes       int64
	SHA256          string
}

type Publisher interface {
	PublishBronzeReady(context.Context, *BronzeReady) error
	Close() error
}

func SubjectFor(kind model.ProductKind) (string, error) {
	switch kind {
	case model.KindTargetPixel:
		return SubjectTargetPixel, nil
	case model.KindLightCurve:
		return SubjectLightCurve, nil
	default:
		return "", fmt.Errorf("events: unknown product kind %q", kind)
	}
}

func NewBronzeReady(eventID, bucket string, product model.ManifestProduct, objectKey, sha256 string) (*BronzeReady, error) {
	if eventID == "" || bucket == "" || objectKey == "" || sha256 == "" {
		return nil, fmt.Errorf("events: event id, bucket, object key, and sha256 are required")
	}
	sampleID := ""
	if product.TICID > 0 && product.Sector > 0 {
		sampleID = plan.SampleID(product.TICID, product.Sector)
	}
	return &BronzeReady{
		EventID: eventID, EventType: TypeBronzeObjectReady, OccurredAt: time.Now().UTC(),
		SourceProductID: product.SourceProductID, SampleID: sampleID, ProductKind: string(product.Kind),
		Bucket: bucket, ObjectKey: objectKey, Sector: product.Sector, TICID: product.TICID,
		Camera: product.Camera, CCD: product.CCD, SizeBytes: product.SizeBytes, SHA256: sha256,
	}, nil
}
