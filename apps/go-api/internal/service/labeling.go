package service

import (
	"context"
	"encoding/json"

	"go-api/internal/domain/entity"
	"go-api/internal/domain/repo"
	domainService "go-api/internal/domain/service"
	"go-api/internal/provider"
)

type LabelingService struct {
	repo   repo.LabelingRepository
	broker *provider.SSEBroker
}

func NewLabelingService(labelingRepo repo.LabelingRepository, broker ...*provider.SSEBroker) domainService.Labeling {
	var b *provider.SSEBroker
	if len(broker) > 0 {
		b = broker[0]
	}
	return &LabelingService{
		repo:   labelingRepo,
		broker: b,
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

func (s *LabelingService) SaveCohortLabel(ctx context.Context, req entity.SaveCohortLabelRequest) error {
	if err := s.repo.SaveCohortLabel(ctx, req); err != nil {
		return err
	}
	if s.broker != nil {
		payload, _ := json.Marshal(map[string]any{
			"type":              "label_saved",
			"snapshot_id":       req.SnapshotID,
			"source_product_id": req.SourceProductID,
			"training_label":    req.TrainingLabel,
		})
		_ = s.broker.Publish(ctx, "ml", provider.Event{
			Type:  "workflow",
			Topic: "ml",
			Data:  payload,
		})
	}
	return nil
}
