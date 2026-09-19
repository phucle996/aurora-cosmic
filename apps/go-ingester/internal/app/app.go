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

	"github.com/nats-io/nats.go"
)

func Run(ctx context.Context, cfg *config.Config, log *slog.Logger, metrics *observer.Metrics) error {
	if cfg == nil {
		return fmt.Errorf("ingester configuration is required")
	}
	if log == nil {
		log = slog.Default()
	}

	nc, err := nats.Connect(cfg.NATS.URL, nats.Name("aurora-ingester"), nats.Timeout(10*time.Second))
	if err != nil {
		return fmt.Errorf("nats connect %s: %w", cfg.NATS.URL, err)
	}
	defer nc.Close()

	runtimeObserver, err := observer.NewIngestRuntimeObserverFromConn(nc)
	if err != nil {
		return fmt.Errorf("start ingest runtime observer: %w", err)
	}

	runner := ingest.NewService(cfg, log, metrics, runtimeObserver)
	ctrl := control.NewController(ctx, cfg.Ingest.Concurrency, runner)
	natsListener, err := control.NewNATSListener(nc, ctrl, log)
	if err != nil {
		return fmt.Errorf("start ingest NATS control listener: %w", err)
	}
	if err := natsListener.Start(); err != nil {
		return err
	}
	defer func() {
		_ = natsListener.Close()
	}()

	log.Info("ingest NATS control ready; waiting for an explicit start command")
	<-ctx.Done()
	log.Info("shutdown signal received; cancelling active ingestion work")
	waitCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := ctrl.Wait(waitCtx); err != nil {
		log.Warn("ingestion work did not stop before shutdown deadline", slog.Any("error", err))
	}
	return nil
}
