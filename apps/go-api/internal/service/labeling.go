package service

import (
	"context"

	"go-api/internal/domain/entity"
	"go-api/internal/domain/repo"
	domainService "go-api/internal/domain/service"
)

type LabelingService struct {
	repo repo.LabelingRepository
}

func NewLabelingService(labelingRepo repo.LabelingRepository) domainService.Labeling {
	return &LabelingService{
		repo: labelingRepo,
	}
}

func (s *LabelingService) ListSnapshots(ctx context.Context, limit int) ([]entity.LabelingSnapshotItem, error) {
	return s.repo.ListSnapshots(ctx, limit)
}

func (s *LabelingService) GetCohortWorkspace(ctx context.Context, snapshotIDs []string, page entity.PageRequest) (*entity.LabelingCohortWorkspace, error) {
	return s.repo.GetCohortWorkspace(ctx, snapshotIDs, page)
}

func (s *LabelingService) GetTargetEvidence(ctx context.Context, snapshotID string, sourceProductID string) (*entity.LabelingTargetDetail, error) {
	return s.repo.GetTargetEvidence(ctx, snapshotID, sourceProductID)
}
