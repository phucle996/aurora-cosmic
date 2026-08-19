package service

import (
	"context"
	"go-api/internal/domain/entity"
)

type Models interface {
	ListModels(context.Context, string) ([]entity.Model, error)
	StartTrainingJob(context.Context, entity.TrainingJobRequest) (*entity.TrainingJobResponse, error)
}
