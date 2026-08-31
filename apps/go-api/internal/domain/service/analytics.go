package service

import (
	"context"
	"go-api/internal/domain/entity"
)

type Analytics interface {
	ListCandidates(context.Context, int, string, entity.PageRequest) (entity.Page[entity.Candidate], error)
	GetCandidate(context.Context, string, string) (*entity.CandidateDetail, error)
	ListAnomalies(context.Context, int, string, bool, entity.PageRequest) (entity.Page[entity.Anomaly], error)
	GetAnomalyDetail(context.Context, string, string) (*entity.AnomalyDetail, error)
	ListTargets(context.Context, entity.TargetQuery) (entity.Page[entity.Target], error)
	GetTarget(context.Context, int64, int, string) (*entity.TargetDetail, error)
	GetLightcurve(context.Context, int64, int, entity.PageRequest) (*entity.Lightcurve, error)
}
