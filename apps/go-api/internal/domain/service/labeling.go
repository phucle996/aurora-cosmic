package service

import (
	"context"

	"go-api/internal/domain/entity"
)

// Labeling định nghĩa các use case phục vụ trực tiếp cho màn hình Labeling Studio.
type Labeling interface {
	ListSnapshots(ctx context.Context, limit int) ([]entity.LabelingSnapshotItem, error)
	GetCohortWorkspace(ctx context.Context, snapshotIDs []string, page entity.PageRequest) (*entity.LabelingCohortWorkspace, error)
	GetTargetEvidence(ctx context.Context, snapshotID string, sourceProductID string) (*entity.LabelingTargetDetail, error)
}
