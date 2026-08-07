package app

import (
	"context"
	"fmt"

	"go-ingester/internal/config"
)

func Run(ctx context.Context, cfg *config.Config) error {
	fmt.Printf("[aurora-ingester] Service runner started in '%s' environment.\n", cfg.Core.Env)

	<-ctx.Done()
	fmt.Println("[aurora-ingester] Shutdown signal received, stopping ingestion tasks...")
	return nil
}
