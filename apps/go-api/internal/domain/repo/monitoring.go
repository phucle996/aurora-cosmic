package repo

import (
	"context"
	"time"

	"go-api/internal/domain/entity"
)

type PrometheusQuerier interface {
	QueryRange(context.Context, string, time.Time, time.Time, time.Duration) ([]entity.MonitoringPoint, error)
}
