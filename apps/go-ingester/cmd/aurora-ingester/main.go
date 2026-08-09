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

	if len(os.Args) < 2 {
		if err := app.Run(ctx, cfg, log, metrics); err != nil {
			log.Error("Runtime error encountered", slog.Any("error", err))
			os.Exit(1)
		}
		log.Info("Shutdown completed gracefully.")
		return
	}

	switch os.Args[1] {
	case "plan":
		if err := runPlan(ctx, cfg, log, os.Args[2:]); err != nil {
			log.Error("plan command failed", slog.Any("error", err))
			os.Exit(1)
		}

	case "ingest":
		if err := runIngest(ctx, cfg, log, os.Args[2:], metrics); err != nil {
			log.Error("ingest command failed", slog.Any("error", err))
			os.Exit(1)
		}

	case "status":
		if err := runStatus(ctx, cfg, log, os.Args[2:]); err != nil {
			log.Error("status command failed", slog.Any("error", err))
			os.Exit(1)
		}

	case "cleanup":
		if err := runCleanup(ctx, cfg, log, os.Args[2:]); err != nil {
			log.Error("cleanup command failed", slog.Any("error", err))
			os.Exit(1)
		}

	default:
		// Legacy runner
		if err := app.Run(ctx, cfg, log, metrics); err != nil {
			log.Error("Runtime error encountered", slog.Any("error", err))
			os.Exit(1)
		}
		log.Info("Shutdown completed gracefully.")
	}
}

func printUsage() {
	fmt.Fprintln(os.Stderr, "usage: aurora-ingester <command> [options]")
	fmt.Fprintln(os.Stderr, "  plan     -- discover and create ingestion manifest")
	fmt.Fprintln(os.Stderr, "  ingest   -- stream products from manifest into MinIO Bronze")
	fmt.Fprintln(os.Stderr, "  status   -- display progress status of the current ingestion run")
	fmt.Fprintln(os.Stderr, "  cleanup  -- enforce Bronze rolling window (--dry-run, --json)")
}
