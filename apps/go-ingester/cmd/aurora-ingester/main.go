package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"go-ingester/internal/app"
	"go-ingester/internal/config"
	"go-ingester/pkg/logger"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintf(os.Stderr, "[aurora-ingester] Startup configuration error: %v\n", err)
		os.Exit(1)
	}

	log := logger.Init(cfg.Core.LogLevel, cfg.Core.Env)
	cfg.LogSummary()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM, syscall.SIGINT)
	defer stop()

	if err := app.Run(ctx, cfg, log); err != nil {
		log.WithError(err).Error("Runtime error encountered")
		os.Exit(1)
	}

	log.Info("Shutdown completed gracefully.")
}
