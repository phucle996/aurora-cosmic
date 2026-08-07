package app

import (
	"context"

	"go-ingester/internal/config"

	"github.com/sirupsen/logrus"
)

func Run(ctx context.Context, cfg *config.Config, log *logrus.Logger) error {
	log.WithFields(logrus.Fields{
		"concurrency": cfg.Ingest.Concurrency,
		"minio":       cfg.MinIO.Endpoint,
		"nats":        cfg.NATS.URL,
	}).Info("Ingester service runner started")

	<-ctx.Done()
	log.Info("Shutdown signal received, stopping ingestion tasks...")
	return nil
}
