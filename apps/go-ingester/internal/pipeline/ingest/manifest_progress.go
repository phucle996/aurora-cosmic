package ingest

import (
	"context"
	"encoding/json"
	"time"

	"go-ingester/infra/storage"
)

const manifestProgressObjectKey = "control/ingest/manifest-status.json"

// manifestProgress is the durable operator-facing view of manifest planning.
// It is deliberately separate from the ingestion checkpoint: no product is
// downloaded until this plan and its catalog pins are complete.
type manifestProgress struct {
	State              string            `json:"state"`
	Stage              string            `json:"stage"`
	Completed          int               `json:"completed"`
	Total              int               `json:"total"`
	StageCompleted     int               `json:"stage_completed,omitempty"`
	StageTotal         int               `json:"stage_total,omitempty"`
	DiscoveredProducts int               `json:"discovered_products"`
	PairedSamples      int               `json:"paired_samples"`
	SelectedSamples    int               `json:"selected_samples"`
	PrioritySamples    int               `json:"priority_samples"`
	CatalogSnapshots   map[string]string `json:"catalog_snapshots,omitempty"`
	Error              string            `json:"error,omitempty"`
	UpdatedAt          time.Time         `json:"updated_at"`
}

func writeManifestProgress(ctx context.Context, store *storage.MinIOClient, bucket string, progress manifestProgress) {
	progress.Total = 5
	progress.UpdatedAt = time.Now().UTC()
	payload, err := json.Marshal(progress)
	if err != nil {
		return
	}
	_ = store.PutJSON(ctx, bucket, manifestProgressObjectKey, payload)
}

func reportManifestFailure(ctx context.Context, store *storage.MinIOClient, bucket, stage string, err error) {
	progress := manifestProgress{State: "FAILED", Stage: stage}
	if err != nil {
		progress.Error = err.Error()
	}
	writeManifestProgress(ctx, store, bucket, progress)
}

func reportManifestCanceled(ctx context.Context, store *storage.MinIOClient, bucket, stage string) {
	writeManifestProgress(ctx, store, bucket, manifestProgress{State: "CANCELED", Stage: stage})
}
