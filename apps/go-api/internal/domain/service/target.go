package service

import (
	"context"

	"go-api/internal/domain/entity"
)

// Target định nghĩa service contract cho sao mục tiêu quan sát và đường cong ánh sáng.
type Target interface {
	ListTargets(ctx context.Context, query entity.TargetQuery) (entity.Page[entity.Target], error)
	GetTarget(ctx context.Context, ticID int64, sector int, snapshotID string) (*entity.TargetDetail, error)
	GetLightcurve(ctx context.Context, ticID int64, sector int, page entity.PageRequest) (*entity.Lightcurve, error)
}
