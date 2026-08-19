package repo

import (
	"context"
	"time"

	"go-api/internal/domain/entity"
)

type ObjectInfo struct {
	Key          string
	Size         int64
	ETag         string
	LastModified time.Time
}

type CatalogObject struct {
	Tier         string    `json:"tier"`
	ObjectKey    string    `json:"object_key"`
	SizeBytes    int64     `json:"size_bytes"`
	ETag         string    `json:"etag"`
	Sector       int32     `json:"sector"`
	TICID        int64     `json:"tic_id"`
	ProductType  string    `json:"product_type"`
	LastModified time.Time `json:"last_modified"`
}

type LakehouseCatalogRepository interface {
	EnsureSchema(ctx context.Context) error
	UpsertObjects(ctx context.Context, objects []CatalogObject) error
	ListObjects(ctx context.Context, tier, prefix string, page, limit int) ([]CatalogObject, int64, int64, error)
	CountObjects(ctx context.Context, tier string) (int64, int64, error)
}

type ObjectRepository interface {
	Ping(context.Context) error
	ListObjects(context.Context, string) ([]ObjectInfo, error)
	GetObject(context.Context, string) ([]byte, error)
	PutObject(context.Context, string, []byte, string) error
	DeleteObject(context.Context, string) error
}

type IngestController interface {
	Start(context.Context, entity.IngestStartRequest) (*entity.IngestControlJob, error)
	Cancel(context.Context, string) (*entity.IngestControlJob, error)
}

type IngestRuntimeController interface {
	Current(context.Context) (*entity.IngestControlJob, error)
}

type WorkflowDispatcher interface {
	Dispatch(context.Context, string, []byte) error
}

type EventPublisher interface {
	Publish(context.Context, entity.WorkflowEvent) error
}
