package service

import (
	"context"
	"go-api/internal/domain/entity"
	"go-api/internal/domain/repo"
	domainService "go-api/internal/domain/service"
)

type AnalyticsService struct{ repository repo.AnalyticsRepository }

func NewAnalyticsService(repository repo.AnalyticsRepository) domainService.Analytics {
	return &AnalyticsService{repository: repository}
}
func (s *AnalyticsService) ListCandidates(ctx context.Context, sector int, snapshotID string, page entity.PageRequest) (entity.Page[entity.Candidate], error) {
	return s.repository.ListCandidates(ctx, sector, snapshotID, page)
}
func (s *AnalyticsService) ListAnomalies(ctx context.Context, sector int, snapshotID string, page entity.PageRequest) (entity.Page[entity.Anomaly], error) {
	return s.repository.ListAnomalies(ctx, sector, snapshotID, page)
}
func (s *AnalyticsService) ListTargets(ctx context.Context, sector int, page entity.PageRequest) (entity.Page[entity.Target], error) {
	return s.repository.ListTargets(ctx, sector, page)
}
func (s *AnalyticsService) GetLightcurve(ctx context.Context, ticID int64, page entity.PageRequest) (*entity.Lightcurve, error) {
	return s.repository.GetLightcurve(ctx, ticID, page)
}
