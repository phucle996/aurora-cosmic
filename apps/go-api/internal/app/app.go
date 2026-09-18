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
	"go-api/internal/provider"
	"go-api/internal/transport/http/middleware"
	"go-api/internal/transport/pubsub"
	"go-api/internal/transport/stream"

	"github.com/gin-gonic/gin"
)

type Infrastructure struct {
	ClickHouse      *clickhouse.Client
	MinIO           *minio.Client
	PredictionMinIO *minio.Client
	NATS            *nats.Dispatcher
	Prometheus      *prometheus.Client
	Ingester        *ingester.Client
}

type App struct {
	Server   *http.Server
	Observer *provider.MetricsServer
	PubSub   *pubsub.NATSPubSub
	Stream   *stream.StreamConsumer
	NATS     *nats.Dispatcher
	Addr     string
}

// Start brings up transport consumers before the HTTP listener is exposed.
// Runtime SSE depends on Core NATS; starting only the REST server would leave
// the dashboard with an open but silent event stream.
func (a *App) Start(ctx context.Context) error {
	if a == nil {
		return fmt.Errorf("app is nil")
	}
	if a.PubSub != nil {
		if err := a.PubSub.Start(ctx); err != nil {
			return fmt.Errorf("start NATS pubsub consumer: %w", err)
		}
		// Zero-overhead connection sharing: re-use the established NATS connection for JetStream
		if a.Stream != nil && a.PubSub.Conn() != nil {
			a.Stream.SetConn(a.PubSub.Conn())
		}
	}
	if a.Stream != nil {
		if err := a.Stream.Start(ctx); err != nil {
			return fmt.Errorf("start NATS stream consumer: %w", err)
		}
	}
	return nil
}

func New(cfg *config.Config, log *slog.Logger) (*App, error) {
	infra := Infrastructure{
		ClickHouse:      clickhouse.NewClient(cfg.ClickHouse.Endpoint, cfg.ClickHouse.Database, cfg.ClickHouse.User, cfg.ClickHouse.Password),
		MinIO:           minio.NewClient(cfg.MinIO.Endpoint, cfg.MinIO.Bucket, cfg.MinIO.AccessKey, cfg.MinIO.SecretKey),
		PredictionMinIO: minio.NewClient(cfg.MinIO.Endpoint, cfg.MinIO.PredictionBucket, cfg.MinIO.AccessKey, cfg.MinIO.SecretKey),
		NATS:            nats.NewDispatcher(cfg.NATS.URL),
		Prometheus:      prometheus.NewClient(cfg.Prometheus.URL),
		Ingester:        ingester.NewClient(cfg.IngesterControlURL),
	}

	module, err := NewModule(infra)
	if err != nil {
		return nil, fmt.Errorf("initialize module: %w", err)
	}

	metrics := provider.NewMetrics()
	router := NewRouter(cfg, module, metrics)
	observerServer, err := provider.StartMetricsServer(cfg.Metrics.Addr, metrics)
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
		PubSub:   module.NATSPubSub,
		Stream:   module.NATSStream,
		NATS:     infra.NATS,
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
	if a.PubSub != nil {
		if err := a.PubSub.Close(); err != nil {
			shutdownErrs = append(shutdownErrs, err)
		}
	}
	if a.NATS != nil {
		if err := a.NATS.Close(); err != nil {
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

// NewRouter constructs a Gin engine configured with global middleware and flat routes.
func NewRouter(cfg *config.Config, module *Module, metrics ...*provider.Metrics) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	engine := gin.New()
	engine.Use(gin.Recovery())
	engine.Use(middleware.CORS(cfg))
	if len(metrics) > 0 && metrics[0] != nil {
		engine.Use(middleware.Metrics(metrics[0]))
	}

	RegisterRoutes(engine, module)
	return engine
}

