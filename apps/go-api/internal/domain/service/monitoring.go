package service

import (
	"context"
	"go-api/internal/domain/entity"
)

type Monitoring interface {
	Query(ctx context.Context, window entity.MonitoringWindow, componentID string) ([]entity.MonitoringComponent, error)
}
