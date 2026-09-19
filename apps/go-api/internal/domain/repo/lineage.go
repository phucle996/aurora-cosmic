package repo

import (
	"context"

	"go-api/internal/domain/entity"
)

// LineageRepository defines the repository port for tracing
// Silver-to-Gold lineage evidence directly from the materialized store.
type LineageRepository interface {
	TraceLineage(ctx context.Context, lookups []entity.LineageLookup) ([]entity.LineageResolution, error)
}
