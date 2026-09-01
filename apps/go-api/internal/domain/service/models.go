package service

import (
	"context"
	"go-api/internal/domain/entity"
)

type Models interface {
	ListModels(context.Context, string) ([]entity.Model, error)
	TrainingReadiness(context.Context, []string) (*entity.TrainingReadiness, error)
	OverrideTrainingLabel(context.Context, entity.TrainingLabelOverride) error
	ListTrainingReviews(context.Context, int) ([]entity.TrainingReview, error)
	StartTrainingJob(context.Context, entity.TrainingJobSpec) (*entity.TrainingJobResult, error)
	SetModelDeployment(ctx context.Context, modelID string, task string, active bool) error
}
