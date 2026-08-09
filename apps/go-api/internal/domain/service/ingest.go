package service

import (
	"context"

	"go-api/internal/domain/entity"
)

type Ingest interface {
	Status(context.Context) (*entity.IngestStatus, error)
	Storage(context.Context, string, int, int) (*entity.StorageListing, error)
	Start(context.Context, entity.IngestStartRequest) (*entity.IngestControlJob, error)
	Cancel(context.Context, string) (*entity.IngestControlJob, error)
}
