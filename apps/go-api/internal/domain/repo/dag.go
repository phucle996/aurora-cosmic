package repo

import (
	"context"

	"go-api/internal/domain/entity"
)

// DAGRepository defines the dedicated query port owned by the DAG workflow.
type DAGRepository interface {
	GetRunEvidence(ctx context.Context, ticketID string) (*entity.DAGRunEvidence, error)
}
