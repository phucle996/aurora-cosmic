package repo

import (
	"context"

	"go-api/internal/domain/entity"
)

// TrainingRepository quản lý dữ liệu sẵn sàng huấn luyện (readiness), nhãn huấn luyện và hàng đợi đánh giá chuyên gia.
type TrainingRepository interface {
	TrainingReadiness(ctx context.Context, snapshotIDs []string) (*entity.TrainingReadiness, error)
	OverrideTrainingLabel(ctx context.Context, override entity.TrainingLabelOverride) error
	ListTrainingReviews(ctx context.Context, limit int) ([]entity.TrainingReview, error)
	ListTrainingReviewQueue(ctx context.Context, snapshotIDs []string, page entity.PageRequest) (entity.Page[entity.TrainingReviewQueueItem], error)
}
