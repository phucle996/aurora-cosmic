package service

import (
	"context"
	"go-api/internal/domain/entity"
)

type Models interface {
	ListModels(context.Context, string) ([]entity.Model, error)
	StartTrainingJob(context.Context, entity.TrainingJobSpec) (*entity.TrainingJobResult, error)
	SetModelDeployment(ctx context.Context, modelID string, task string, active bool) error
}
