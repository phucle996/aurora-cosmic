package service

import (
	"context"

	"go-api/internal/domain/entity"
)

type LineageService interface {
	TraceLineage(ctx context.Context, inputs []entity.LineageLookup) ([]entity.LineageResolution, error)
	GetLedger(ctx context.Context, query entity.LineageLedgerQuery) (*entity.LineageLedgerResponse, error)
}
