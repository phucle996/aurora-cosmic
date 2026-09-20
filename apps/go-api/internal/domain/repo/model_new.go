package repo

import (
	"context"

	"go-api/internal/domain/entity"
)

// ModelNewRepository defines the repository interface for Model domain workflows.
type ModelNewRepository interface {
	TrainingPreflight(ctx context.Context, snapshotIDs []string) (*entity.TrainingPreflight, error)
	ListTrainingSnapshots(ctx context.Context, limit int) ([]entity.ModelTrainingSnapshot, error)
}
