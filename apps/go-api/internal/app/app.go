package app

import (
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"time"

	"go-api/infra/clickhouse"
	"go-api/infra/minio"
	"go-api/infra/nats"
	"go-api/infra/prometheus"
	"go-api/internal/config"
)

type Infrastructure struct {
	ClickHouse *clickhouse.Client
	MinIO      *minio.Client
	NATS       *nats.Dispatcher
	Prometheus *prometheus.Client
}

type App struct {
	Server *http.Server
	Addr   string
}

func New(cfg *config.Config, log *slog.Logger) (*App, error) {
	infra := Infrastructure{
		ClickHouse: clickhouse.NewClient(cfg.ClickHouse.Endpoint, cfg.ClickHouse.Database, cfg.ClickHouse.User, cfg.ClickHouse.Password),
		MinIO:      minio.NewClient(cfg.MinIO.Endpoint, cfg.MinIO.Bucket, cfg.MinIO.AccessKey, cfg.MinIO.SecretKey),
		NATS:       nats.NewDispatcher(cfg.NATS.URL),
		Prometheus: prometheus.NewClient(cfg.Prometheus.URL),
	}

	module, err := NewModule(infra)
	if err != nil {
		return nil, fmt.Errorf("initialize module: %w", err)
	}

	router := NewRouter(cfg, module)
	addr := net.JoinHostPort(cfg.Server.Host, fmt.Sprintf("%d", cfg.Server.Port))

	srv := &http.Server{
		Addr:              addr,
		Handler:           router,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}

	return &App{
		Server: srv,
		Addr:   addr,
	}, nil
}
