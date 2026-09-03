package service

import (
	"context"
	"go-api/internal/domain/entity"
)

type Inference interface {
	ListJobs(context.Context, string, string) ([]entity.InferenceJob, error)
	RetryJob(context.Context, string) (entity.InferenceJobManifest, map[string]any, error)
}

// ChampionInferencePlanner keeps every committed candidate Gold snapshot
// covered by the currently serving runtime package. Implementations must be
// idempotent because both startup reconciliation and Gold commit events can
// request the same work.
type ChampionInferencePlanner interface {
	EnsureChampionCoverage(context.Context, string) (int, error)
	ReconcileChampionCoverage(context.Context) (int, error)
}
