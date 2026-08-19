package service

import (
	"context"

	"go-api/internal/domain/entity"
	"go-api/internal/domain/repo"
	domainService "go-api/internal/domain/service"
	"go-api/internal/physics"
)

type AnalyticsService struct{ repository repo.AnalyticsRepository }

func NewAnalyticsService(repository repo.AnalyticsRepository) domainService.Analytics {
	return &AnalyticsService{repository: repository}
}

func (s *AnalyticsService) ListCandidates(ctx context.Context, sector int, snapshotID string, page entity.PageRequest) (entity.Page[entity.Candidate], error) {
	return s.repository.ListCandidates(ctx, sector, snapshotID, page)
}

func (s *AnalyticsService) GetCandidate(ctx context.Context, predictionID string, snapshotID string) (*entity.CandidateDetail, error) {
	detail, err := s.repository.GetCandidate(ctx, predictionID, snapshotID)
	if err != nil {
		return nil, err
	}
	detail.Physics, detail.Habitability = physics.DeriveCandidate(detail.Candidate, detail.Evidence)
	return detail, nil
}

func (s *AnalyticsService) ListAnomalies(ctx context.Context, sector int, snapshotID string, flaggedOnly bool, page entity.PageRequest) (entity.Page[entity.Anomaly], error) {
	return s.repository.ListAnomalies(ctx, sector, snapshotID, flaggedOnly, page)
}

func (s *AnalyticsService) ListTargets(ctx context.Context, query entity.TargetQuery) (entity.Page[entity.Target], error) {
	return s.repository.ListTargets(ctx, query)
}

func (s *AnalyticsService) GetTarget(ctx context.Context, ticID int64, sector int) (*entity.TargetDetail, error) {
	return s.repository.GetTarget(ctx, ticID, sector)
}

func (s *AnalyticsService) GetLightcurve(ctx context.Context, ticID int64, sector int, page entity.PageRequest) (*entity.Lightcurve, error) {
	return s.repository.GetLightcurve(ctx, ticID, sector, page)
}
