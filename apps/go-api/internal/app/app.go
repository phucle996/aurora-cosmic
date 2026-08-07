package app

import (
	"context"
	"fmt"

	"go-api/internal/config"
)

func Run(ctx context.Context, cfg *config.Config) error {
	fmt.Printf("[aurora-api] API Server listening on %s:%d...\n", cfg.Server.Host, cfg.Server.Port)

	<-ctx.Done()
	fmt.Println("[aurora-api] Shutdown signal received, stopping HTTP server...")
	return nil
}
