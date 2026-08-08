package service

import (
	"context"
	"go-api/internal/domain/entity"
)

type Monitoring interface {
	Query(context.Context, entity.MonitoringWindow, string) ([]entity.MonitoringComponent, error)
}
