package repo

import (
	"context"
	"errors"
	"go-api/internal/domain/entity"
)

var ErrNotFound = errors.New("analytics record not found")

type AnalyticsRepository interface {
	Ping(context.Context) error
	ListCandidates(context.Context, int, string, entity.PageRequest) (entity.Page[entity.Candidate], error)
	GetCandidate(context.Context, string, string) (*entity.CandidateDetail, error)
	ListAnomalies(context.Context, int, string, bool, entity.PageRequest) (entity.Page[entity.Anomaly], error)
	GetAnomaly(context.Context, string, string) (*entity.Anomaly, error)
	ListTargets(context.Context, entity.TargetQuery) (entity.Page[entity.Target], error)
	GetTarget(context.Context, int64, int) (*entity.TargetDetail, error)
	GetLightcurve(context.Context, int64, int, entity.PageRequest) (*entity.Lightcurve, error)
}
