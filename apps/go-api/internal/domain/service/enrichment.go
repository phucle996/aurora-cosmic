package service

import (
	"context"

	"go-api/internal/domain/entity"
)

type EnrichmentControl interface {
	// GetControlOverview returns the aggregate state of the enrichment system,
	// combining the desired operator control state and live worker runtime telemetry.
	GetControlOverview(context.Context) (*entity.EnrichmentControlOverview, error)
	Start(context.Context, entity.EnrichmentControlStartRequest) (*entity.EnrichmentCommandResult, error)
	Stop(context.Context) (*entity.EnrichmentCommandResult, error)
	ResolveLineage(context.Context, []entity.EnrichmentLineageLookup) ([]entity.EnrichmentLineageResolution, error)
	ListSnapshots(context.Context, int) ([]entity.EnrichmentSnapshotSummary, error)
	Snapshot(context.Context, string) (*entity.EnrichmentSnapshotDetail, error)
	Artifact(context.Context, string, string, int, entity.EnrichmentArtifactPreviewQuery) (*entity.EnrichmentArtifactDetail, error)
}
