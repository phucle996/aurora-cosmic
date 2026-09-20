package repo

import (
	"context"

	"go-api/internal/domain/entity"
)

// LabelingRepository định nghĩa cổng truy vấn ClickHouse chuyên biệt cho Labeling Studio.
type LabelingRepository interface {
	ListSnapshots(ctx context.Context, limit int) ([]entity.LabelingSnapshotItem, error)
	GetCohortWorkspace(ctx context.Context, snapshotIDs []string, page entity.PageRequest) (*entity.LabelingCohortWorkspace, error)
	GetTargetEvidence(ctx context.Context, snapshotID string, sourceProductID string) (*entity.LabelingTargetDetail, error)
}
