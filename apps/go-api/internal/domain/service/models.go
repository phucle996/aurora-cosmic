package service

import (
	"context"
	"go-api/internal/domain/entity"
)

type Models interface {
	ListModels(context.Context, string) ([]entity.Model, error)
	GetModelEvaluation(context.Context, string) (*entity.ModelEvaluation, error)
	TrainingReadiness(context.Context, []string) (*entity.TrainingReadiness, error)
	OverrideTrainingLabel(context.Context, entity.TrainingLabelOverride) error
	ListTrainingReviews(context.Context, int) ([]entity.TrainingReview, error)
	ListTrainingReviewQueue(context.Context, []string, entity.PageRequest) (entity.Page[entity.TrainingReviewQueueItem], error)
	StartTrainingJob(context.Context, entity.TrainingJobSpec) (*entity.TrainingJobResult, error)
	SetModelDeployment(ctx context.Context, modelID string, task string, active bool, ticketID string) (*entity.ModelDeploymentResult, error)
}
