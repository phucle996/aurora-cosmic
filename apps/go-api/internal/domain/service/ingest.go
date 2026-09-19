package service

import (
	"context"

	"go-api/internal/domain/entity"
)

type Ingest interface {
	Status(context.Context) (*entity.IngestStatus, error)
	Storage(ctx context.Context, prefix string, cursor string, limit int) (*entity.StorageListing, error)
	Start(context.Context, entity.IngestStartRequest) (*entity.IngestControlJob, error)
	Cancel(ctx context.Context, ticketID string) (*entity.IngestControlJob, error)
}
