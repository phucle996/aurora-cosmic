package repo

import (
	"context"

	"go-api/internal/domain/entity"
)

type PredictionProjectionRepository interface {
	ExistingPredictionIDs(context.Context, string, []string) (map[string]struct{}, error)
	InsertCandidatePredictions(context.Context, []entity.CandidatePredictionProjection) error
	InsertAnomalyPredictions(context.Context, []entity.AnomalyPredictionProjection) error
}
