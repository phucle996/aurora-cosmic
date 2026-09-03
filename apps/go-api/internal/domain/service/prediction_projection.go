package service

import (
	"context"

	"go-api/internal/domain/entity"
)

type PredictionProjector interface {
	Reconcile(context.Context) (int64, error)
	ProjectCompletion(context.Context, []byte) (entity.PredictionProjectionResult, error)
}
