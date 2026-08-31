package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"go-ingester/internal/app"
	"go-ingester/internal/config"
	"go-ingester/internal/observer"
	"go-ingester/pkg/logger"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintf(os.Stderr, "[aurora-ingester] Startup configuration error: %v\n", err)
		os.Exit(1)
	}

	log := logger.Init(cfg)
	cfg.LogSummary(log)

	metrics := observer.New()
	metricsServer, err := observer.Start(cfg.Metrics.Addr, metrics)
	if err != nil {
		log.Error("metrics server startup failed", slog.Any("error", err))
		os.Exit(1)
	}
	defer func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		if err := metricsServer.Shutdown(shutdownCtx); err != nil {
			log.Warn("metrics server shutdown failed", slog.Any("error", err))
		}
	}()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM, syscall.SIGINT)
	defer stop()

	if err := app.Run(ctx, cfg, log, metrics); err != nil {
		log.Error("Runtime error encountered", slog.Any("error", err))
		os.Exit(1)
	}
	log.Info("Shutdown completed gracefully.")
}
