package service

import (
	"context"
	"log/slog"
	"time"

	"go-api/internal/domain/repo"
	domainService "go-api/internal/domain/service"
)

type ReadinessService struct {
	minio     repo.ObjectRepository
	analytics repo.AnalyticsRepository
}

func NewReadinessService(minio repo.ObjectRepository, analytics repo.AnalyticsRepository) domainService.Readiness {
	return &ReadinessService{minio: minio, analytics: analytics}
}

func (s *ReadinessService) Check(parent context.Context) (map[string]string, bool) {
	ctx, cancel := context.WithTimeout(parent, 2*time.Second)
	defer cancel()
	status := map[string]string{"storage_minio": "DOWN", "query_engine": "DOWN", "ml_inference": "NOT_CHECKED"}
	ready := true
	if s.minio != nil {
		if err := s.minio.Ping(ctx); err == nil {
			status["storage_minio"] = "UP"
		} else {
			slog.Default().Warn("MinIO readiness check failed", slog.Any("error", err))
			ready = false
		}
	} else {
		ready = false
	}
	if s.analytics != nil {
		if err := s.analytics.Ping(ctx); err == nil {
			status["query_engine"] = "UP"
		} else {
			slog.Default().Warn("ClickHouse readiness check failed", slog.Any("error", err))
			ready = false
		}
	} else {
		ready = false
	}
	return status, ready
}
