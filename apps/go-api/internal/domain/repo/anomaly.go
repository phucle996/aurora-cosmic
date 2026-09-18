package repo

import (
	"context"

	"go-api/internal/domain/entity"
)

// AnomalyRepository định nghĩa các thao tác truy xuất dị thường trắc quang được phát hiện bởi mô hình học máy.
type AnomalyRepository interface {
	ListAnomalies(context.Context, int, string, bool, entity.PageRequest) (entity.Page[entity.Anomaly], error)
	GetAnomaly(context.Context, string, string) (*entity.Anomaly, error)
}
