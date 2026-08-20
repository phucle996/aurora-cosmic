package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"time"

	"go-api/infra/clickhouse"
	"go-api/infra/ingester"
	"go-api/infra/minio"
	"go-api/infra/nats"
	"go-api/infra/prometheus"
	"go-api/internal/config"
	"go-api/internal/observer"
	"go-api/internal/transport/stream"
)

type Infrastructure struct {
	ClickHouse *clickhouse.Client
	MinIO      *minio.Client
	NATS       *nats.Dispatcher
	Prometheus *prometheus.Client
	Ingester   *ingester.Client
}

type App struct {
	Server   *http.Server
	Observer *observer.Server
	Stream   *stream.NATSStream
	Addr     string
}

func New(cfg *config.Config, log *slog.Logger) (*App, error) {
	infra := Infrastructure{
		ClickHouse: clickhouse.NewClient(cfg.ClickHouse.Endpoint, cfg.ClickHouse.Database, cfg.ClickHouse.User, cfg.ClickHouse.Password),
		MinIO:      minio.NewClient(cfg.MinIO.Endpoint, cfg.MinIO.Bucket, cfg.MinIO.AccessKey, cfg.MinIO.SecretKey),
		NATS:       nats.NewDispatcher(cfg.NATS.URL),
		Prometheus: prometheus.NewClient(cfg.Prometheus.URL),
		Ingester:   ingester.NewClient(cfg.IngesterControlURL),
	}

	module, err := NewModule(infra)
	if err != nil {
		return nil, fmt.Errorf("initialize module: %w", err)
	}

	metrics := observer.New()
	router := NewRouter(cfg, module, metrics)
	observerServer, err := observer.Start(cfg.Metrics.Addr, metrics)
	if err != nil {
		return nil, fmt.Errorf("start observer: %w", err)
	}
	addr := net.JoinHostPort(cfg.Server.Host, fmt.Sprintf("%d", cfg.Server.Port))

	srv := &http.Server{
		Addr:              addr,
		Handler:           router,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		// SSE workflow streams are intentionally long-lived. Downstream calls
		// keep their own bounded contexts instead of this connection timeout.
		WriteTimeout:   0,
		IdleTimeout:    60 * time.Second,
		MaxHeaderBytes: 1 << 20,
	}

	return &App{
		Server:   srv,
		Observer: observerServer,
		Stream:   module.NATSStream,
		Addr:     addr,
	}, nil
}

// Shutdown gracefully stops the public API, its dedicated observer, and the NATS stream consumer.
func (a *App) Shutdown(ctx context.Context) error {
	if a == nil {
		return nil
	}
	var shutdownErrs []error
	if a.Stream != nil {
		if err := a.Stream.Close(); err != nil {
			shutdownErrs = append(shutdownErrs, err)
		}
	}
	if a.Server != nil {
		if err := a.Server.Shutdown(ctx); err != nil {
			shutdownErrs = append(shutdownErrs, err)
		}
	}
	if a.Observer != nil {
		if err := a.Observer.Shutdown(ctx); err != nil {
			shutdownErrs = append(shutdownErrs, err)
		}
	}
	return errors.Join(shutdownErrs...)
}
