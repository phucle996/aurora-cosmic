package app

import (
	"context"
	"log/slog"

	"go-ingester/internal/config"
)

func Run(ctx context.Context, cfg *config.Config, log *slog.Logger) error {
	log.Info("Ingester service runner started",
		slog.Int("concurrency", cfg.Ingest.Concurrency),
		slog.String("minio", cfg.MinIO.Endpoint),
		slog.String("nats", cfg.NATS.URL),
	)

	<-ctx.Done()
	log.Info("Shutdown signal received, stopping ingestion tasks...")
	return nil
}
