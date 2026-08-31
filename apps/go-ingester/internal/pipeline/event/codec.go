package event

import "encoding/json"

type bronzeReadyDocument struct {
	EventID         string `json:"event_id"`
	EventType       string `json:"event_type"`
	OccurredAt      string `json:"occurred_at"`
	SourceProductID string `json:"source_product_id"`
	SampleID        string `json:"sample_id,omitempty"`
	ProductKind     string `json:"product_kind"`
	Bucket          string `json:"bucket"`
	ObjectKey       string `json:"object_key"`
	Sector          int    `json:"sector"`
	TICID           int64  `json:"tic_id,omitempty"`
	Camera          int    `json:"camera,omitempty"`
	CCD             int    `json:"ccd,omitempty"`
	SizeBytes       int64  `json:"size_bytes"`
	SHA256          string `json:"sha256"`
}

func MarshalBronzeReady(event *BronzeReady) ([]byte, error) {
	return json.Marshal(bronzeReadyDocument{
		EventID: event.EventID, EventType: event.EventType, OccurredAt: event.OccurredAt.UTC().Format("2006-01-02T15:04:05.999999999Z07:00"),
		SourceProductID: event.SourceProductID, SampleID: event.SampleID, ProductKind: event.ProductKind,
		Bucket: event.Bucket, ObjectKey: event.ObjectKey, Sector: event.Sector, TICID: event.TICID,
		Camera: event.Camera, CCD: event.CCD, SizeBytes: event.SizeBytes, SHA256: event.SHA256,
	})
}
