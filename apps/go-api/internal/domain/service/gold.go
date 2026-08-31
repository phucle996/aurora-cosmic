package service

import (
	"context"

	"go-api/internal/domain/entity"
)

type GoldControl interface {
	Query(context.Context) (*entity.GoldControlOverview, error)
	Start(context.Context, entity.GoldControlStartRequest) (*entity.GoldControlOverview, error)
	Stop(context.Context) (*entity.GoldControlOverview, error)
	ResolveLineage(context.Context, []entity.GoldLineageLookup) ([]entity.GoldLineageResolution, error)
	ListSnapshots(context.Context, int) ([]entity.GoldSnapshotSummary, error)
	Snapshot(context.Context, string) (*entity.GoldSnapshotDetail, error)
	Artifact(context.Context, string, string, int, entity.GoldArtifactPreviewQuery) (*entity.GoldArtifactDetail, error)
}
