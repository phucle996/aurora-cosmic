// Package app wires Aurora's process-level dependencies. The HTTP transport
// lives in control and the ingestion workflow lives in pipeline/ingest.
package app

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"go-ingester/internal/config"
	"go-ingester/internal/control"
	"go-ingester/internal/observer"
	"go-ingester/internal/pipeline/ingest"
)

func Run(ctx context.Context, cfg *config.Config, log *slog.Logger, metrics *observer.Metrics) error {
	if cfg == nil {
		return fmt.Errorf("ingester configuration is required")
	}
	if log == nil {
		log = slog.Default()
	}

	runtimeObserver, err := observer.NewIngestRuntimeObserver(cfg.NATS.URL)
	if err != nil {
		return fmt.Errorf("start ingest runtime observer: %w", err)
	}
	defer runtimeObserver.Close()

	runner := ingest.NewService(cfg, log, metrics, runtimeObserver)
	jobs := control.NewJobManager(ctx, cfg.Ingest.Concurrency, runner)
	server := control.NewServer(cfg.Control.Addr, jobs)
	if err := server.Start(); err != nil {
		return err
	}
	defer func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			log.Warn("ingest control shutdown failed", slog.Any("error", err))
		}
	}()

	log.Info("ingest control ready; waiting for an explicit UI start command")
	<-ctx.Done()
	log.Info("shutdown signal received; cancelling active ingestion work")
	waitCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := jobs.Wait(waitCtx); err != nil {
		log.Warn("ingestion work did not stop before shutdown deadline", slog.Any("error", err))
	}
	return nil
}
