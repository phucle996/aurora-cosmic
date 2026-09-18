package repo

import (
	"context"

	"go-api/internal/domain/entity"
)

// TargetRepository định nghĩa các thao tác truy xuất dữ liệu sao mục tiêu và đường cong ánh sáng.
type TargetRepository interface {
	ListTargets(context.Context, entity.TargetQuery) (entity.Page[entity.Target], error)
	GetTarget(context.Context, int64, int, string) (*entity.TargetDetail, error)
	GetLightcurve(context.Context, int64, int, entity.PageRequest) (*entity.Lightcurve, error)
}
