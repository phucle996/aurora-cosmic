package service

import (
	"context"

	"go-api/internal/domain/entity"
)

// DAGAggregation provides visual topology graph and on-demand per-step metrics.
// It visualizes unified end-to-end processing across Preprocessing and Enrichment stages.
type DAGAggregation interface {
	QueryGraph(ctx context.Context, stage string, ticketID string) (*entity.DAGGraph, error)
	AggregateHopMetrics(ctx context.Context, ticketID string, hopID string) (*entity.DAGHop, error)
	ObserveRuntime(event entity.PreprocessingRuntimeEvent)
}
