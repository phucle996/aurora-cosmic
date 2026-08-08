package repo

import (
	"context"
	"go-api/internal/domain/entity"
)

type AnalyticsRepository interface {
	Ping(context.Context) error
	ListCandidates(context.Context, int, string, entity.PageRequest) (entity.Page[entity.Candidate], error)
	ListAnomalies(context.Context, int, string, entity.PageRequest) (entity.Page[entity.Anomaly], error)
	ListTargets(context.Context, int, entity.PageRequest) (entity.Page[entity.Target], error)
	GetLightcurve(context.Context, int64, entity.PageRequest) (*entity.Lightcurve, error)
}
