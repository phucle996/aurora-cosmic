package service

import (
	"context"

	"go-api/internal/domain/entity"
)

type Preprocessing interface {
	Query(context.Context) (*entity.PreprocessingGraph, error)
	Start(context.Context, entity.PreprocessingStartRequest) (*entity.PreprocessingControlJob, error)
	Stop(context.Context, string) (*entity.PreprocessingControlJob, error)
}
