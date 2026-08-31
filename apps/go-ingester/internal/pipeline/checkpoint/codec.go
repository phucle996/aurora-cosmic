package checkpoint

import (
	"encoding/json"
	"time"

	"go-ingester/internal/model"
)

type document struct {
	SchemaVersion int                        `json:"schema_version"`
	RunID         string                     `json:"run_id"`
	Status        string                     `json:"status"`
	ManifestPath  string                     `json:"manifest_path"`
	ManifestHash  string                     `json:"manifest_hash"`
	StartedAt     time.Time                  `json:"started_at"`
	UpdatedAt     time.Time                  `json:"updated_at"`
	Products      map[string]productDocument `json:"products"`
}

type productDocument struct {
	SourceProductID   string    `json:"source_product_id"`
	SampleID          string    `json:"sample_id,omitempty"`
	ProductKind       string    `json:"product_kind"`
	SourceURI         string    `json:"source_uri"`
	ObjectKey         string    `json:"object_key"`
	ExpectedSizeBytes int64     `json:"expected_size_bytes"`
	SizeBytes         int64     `json:"size_bytes,omitempty"`
	SHA256            string    `json:"sha256,omitempty"`
	State             string    `json:"state"`
	Attempts          int       `json:"attempts"`
	LastError         string    `json:"last_error,omitempty"`
	Sector            int       `json:"sector"`
	TICID             int64     `json:"tic_id,omitempty"`
	Camera            int       `json:"camera,omitempty"`
	CCD               int       `json:"ccd,omitempty"`
	UpdatedAt         time.Time `json:"updated_at"`
}

type pointerDocument struct {
	ActiveRunID   string    `json:"active_run_id"`
	ManifestPath  string    `json:"manifest_path"`
	ManifestHash  string    `json:"manifest_hash"`
	LastUpdatedAt time.Time `json:"last_updated_at"`
}

func marshalCheckpoint(checkpoint *model.Checkpoint) ([]byte, error) {
	return json.MarshalIndent(toDocument(checkpoint), "", "  ")
}

func unmarshalCheckpoint(data []byte) (*model.Checkpoint, error) {
	var value document
	if err := json.Unmarshal(data, &value); err != nil {
		return nil, err
	}
	return fromDocument(value), nil
}

func marshalPointer(pointer model.CurrentPointer) ([]byte, error) {
	return json.MarshalIndent(pointerDocument(pointer), "", "  ")
}

func unmarshalPointer(data []byte) (model.CurrentPointer, error) {
	var value pointerDocument
	if err := json.Unmarshal(data, &value); err != nil {
		return model.CurrentPointer{}, err
	}
	return model.CurrentPointer(value), nil
}

func toDocument(checkpoint *model.Checkpoint) document {
	if checkpoint == nil {
		return document{}
	}
	products := make(map[string]productDocument, len(checkpoint.Products))
	for id, product := range checkpoint.Products {
		if product == nil {
			continue
		}
		products[id] = productDocument{SourceProductID: product.SourceProductID, SampleID: product.SampleID, ProductKind: string(product.ProductKind), SourceURI: product.SourceURI, ObjectKey: product.ObjectKey, ExpectedSizeBytes: product.ExpectedSizeBytes, SizeBytes: product.SizeBytes, SHA256: product.SHA256, State: string(product.State), Attempts: product.Attempts, LastError: product.LastError, Sector: product.Sector, TICID: product.TICID, Camera: product.Camera, CCD: product.CCD, UpdatedAt: product.UpdatedAt}
	}
	return document{SchemaVersion: checkpoint.SchemaVersion, RunID: checkpoint.RunID, Status: string(checkpoint.Status), ManifestPath: checkpoint.ManifestPath, ManifestHash: checkpoint.ManifestHash, StartedAt: checkpoint.StartedAt, UpdatedAt: checkpoint.UpdatedAt, Products: products}
}

func fromDocument(document document) *model.Checkpoint {
	products := make(map[string]*model.ProductCheckpoint, len(document.Products))
	for id, product := range document.Products {
		products[id] = &model.ProductCheckpoint{SourceProductID: product.SourceProductID, SampleID: product.SampleID, ProductKind: model.ProductKind(product.ProductKind), SourceURI: product.SourceURI, ObjectKey: product.ObjectKey, ExpectedSizeBytes: product.ExpectedSizeBytes, SizeBytes: product.SizeBytes, SHA256: product.SHA256, State: model.ProductState(product.State), Attempts: product.Attempts, LastError: product.LastError, Sector: product.Sector, TICID: product.TICID, Camera: product.Camera, CCD: product.CCD, UpdatedAt: product.UpdatedAt}
	}
	return &model.Checkpoint{SchemaVersion: document.SchemaVersion, RunID: document.RunID, Status: model.RunStatus(document.Status), ManifestPath: document.ManifestPath, ManifestHash: document.ManifestHash, StartedAt: document.StartedAt, UpdatedAt: document.UpdatedAt, Products: products}
}
