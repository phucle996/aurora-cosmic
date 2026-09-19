package service

import (
	"context"

	"go-api/internal/domain/entity"
)

// DAGAggregation provides visual topology graph and on-demand per-step metrics.
// It remains decoupled from domain preprocessing pipelines and focuses purely on step-level visualization.
type DAGAggregation interface {
	QueryGraph(ctx context.Context) (*entity.PreprocessingGraph, error)
	AggregateHopMetrics(ctx context.Context, ticketID string, hopID string) (*entity.PreprocessingHop, error)
	ObserveRuntime(event entity.PreprocessingRuntimeEvent)
}
