package repo

import (
	"context"

	"go-api/internal/domain/entity"
)

// IngestController định nghĩa port điều khiển daemon thu thập dữ liệu (Go Ingester)
type IngestController interface {
	Start(context.Context, entity.IngestStartRequest) (*entity.IngestControlJob, error)
	Cancel(context.Context, string) (*entity.IngestControlJob, error)
}

// IngestRuntimeController định nghĩa port truy vấn trạng thái runtime của job thu thập
type IngestRuntimeController interface {
	Current(context.Context) (*entity.IngestControlJob, error)
}
