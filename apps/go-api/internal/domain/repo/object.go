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

type ObjectRepository interface {
	Ping(context.Context) error
	ListObjects(context.Context, string) ([]ObjectInfo, error)
	GetObject(context.Context, string) ([]byte, error)
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
