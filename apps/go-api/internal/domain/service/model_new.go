package service

import (
	"context"

	"go-api/internal/domain/entity"
)

// ModelNew defines the service contract for Model domain workflows.
type ModelNew interface {
	TrainingPreflight(ctx context.Context, snapshotIDs []string) (*entity.TrainingPreflight, error)
	ListTrainingSnapshots(ctx context.Context, limit int) ([]entity.ModelTrainingSnapshot, error)
	StartTraining(ctx context.Context, spec entity.StartTrainingSpec) (*entity.TrainingResult, error)
	ControlTraining(ctx context.Context, spec entity.TrainingControlSpec) (*entity.TrainingControlResult, error)
	GetActiveTraining(ctx context.Context, ticketID string) (*entity.TrainingActiveState, error)
	ObserveTrainingProgress(ctx context.Context, event map[string]any) error
	ObserveTrainingLog(ctx context.Context, ticketID string, entry entity.TrainingLogEntry) error
}

