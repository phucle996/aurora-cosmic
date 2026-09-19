package service

import (
	"context"

	"go-api/internal/domain/entity"
)

type Preprocessing interface {
	Start(context.Context, entity.PreprocessingStartRequest) (*entity.PreprocessingControlJob, error)
	Stop(context.Context, string) (*entity.PreprocessingControlJob, error)
	GetActiveJob(context.Context) (*entity.PreprocessingControlJob, error)
}
