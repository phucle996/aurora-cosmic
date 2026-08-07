package app

import (
	"context"
	"log/slog"

	"go-api/internal/config"
)

func Run(ctx context.Context, cfg *config.Config, log *slog.Logger) error {
	log.Info("API server started",
		slog.String("host", cfg.Server.Host),
		slog.Int("port", cfg.Server.Port),
	)

	<-ctx.Done()
	log.Info("Shutdown signal received, stopping HTTP server...")
	return nil
}
