package service

import (
	"context"

	"go-api/internal/domain/entity"
)

type EnrichmentControl interface {
	GetControlOverview(context.Context) (*entity.EnrichmentControlOverview, error)
	Start(context.Context, entity.EnrichmentControlStartRequest) (*entity.EnrichmentCommandResult, error)
	Stop(context.Context) (*entity.EnrichmentCommandResult, error)
	ListSnapshots(context.Context, int) ([]entity.EnrichmentSnapshotSummary, error)
	Snapshot(context.Context, string) (*entity.EnrichmentSnapshotDetail, error)
}
