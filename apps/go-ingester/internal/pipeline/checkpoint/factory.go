package checkpoint

import (
	"fmt"
	"time"

	"go-ingester/internal/model"
	"go-ingester/internal/pipeline/plan"
	"go-ingester/internal/pipeline/storage"
)

const (
	SchemaVersion = 1
	PointerKey    = "checkpoints/ingestion/current.json"
)

func RunKey(runID string) string {
	return fmt.Sprintf("checkpoints/ingestion/runs/%s.json", runID)
}

func ManifestHash(manifest *model.Manifest) (string, error) {
	return plan.Hash(manifest)
}

func NewInitial(runID, manifestPath, manifestHash string, products []model.ManifestProduct) *model.Checkpoint {
	now := time.Now().UTC()
	states := make(map[string]*model.ProductCheckpoint, len(products))
	for _, product := range products {
		objectKey, _ := storage.ObjectKeyFor(product)
		sampleID := ""
		if product.TICID > 0 && product.Sector > 0 {
			sampleID = plan.SampleID(product.TICID, product.Sector)
		}
		states[product.SourceProductID] = &model.ProductCheckpoint{
			SourceProductID: product.SourceProductID, SampleID: sampleID, ProductKind: product.Kind,
			SourceURI: product.DataURI, ObjectKey: objectKey, ExpectedSizeBytes: product.SizeBytes,
			State: model.StatePlanned, Sector: product.Sector, TICID: product.TICID,
			Camera: product.Camera, CCD: product.CCD, UpdatedAt: now,
		}
	}
	return &model.Checkpoint{SchemaVersion: SchemaVersion, RunID: runID, Status: model.RunStatusRunning, ManifestPath: manifestPath, ManifestHash: manifestHash, StartedAt: now, UpdatedAt: now, Products: states}
}
