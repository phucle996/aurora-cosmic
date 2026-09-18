package service

import (
	"context"

	"go-api/internal/domain/entity"
)

// Anomaly định nghĩa service contract cho dị thường trắc quang và giải thích mô hình.
type Anomaly interface {
	ListAnomalies(ctx context.Context, sector int, snapshotID string, flaggedOnly bool, page entity.PageRequest) (entity.Page[entity.Anomaly], error)
	GetAnomalyDetail(ctx context.Context, predictionID string, snapshotID string) (*entity.AnomalyDetail, error)
}
