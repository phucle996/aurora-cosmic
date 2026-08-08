package app

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"time"

	"go-api/internal/config"
	apiHttp "go-api/internal/http"
	"go-api/internal/store"
)

func Run(ctx context.Context, cfg *config.Config, log *slog.Logger) error {
	chStore := store.NewClickHouseStore(cfg.ClickHouse.Endpoint, cfg.ClickHouse.Database)
	chStore.SetCredentials(cfg.ClickHouse.User, cfg.ClickHouse.Password)
	minioStore := store.NewMinIOStore(cfg.MinIO.Endpoint, cfg.MinIO.Bucket)
	router := apiHttp.NewRouter(chStore, minioStore, cfg.CORSAllowedOrigin)
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

	serverErr := make(chan error, 1)
	go func() {
		log.Info("HTTP REST API Gateway listening",
			slog.String("address", addr),
			slog.String("host", cfg.Server.Host),
			slog.Int("port", cfg.Server.Port),
		)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			serverErr <- err
		}
	}()

	select {
	case err := <-serverErr:
		return fmt.Errorf("server error: %w", err)
	case <-ctx.Done():
		log.Info("Shutdown signal received, draining active connections...")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return srv.Shutdown(shutdownCtx)
	}
}
