package repo

import (
	"context"
	"errors"
)

var ErrNotFound = errors.New("analytics record not found")

// AnalyticsRepository là interface tổng hợp cho ClickHouse analytics persistence layer
type AnalyticsRepository interface {
	TargetRepository
	CandidateRepository
	AnomalyRepository
	TrainingRepository
	Ping(context.Context) error
}
