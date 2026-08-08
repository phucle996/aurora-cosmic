package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"go-api/internal/app"
	"go-api/internal/config"
	"go-api/pkg/logger"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintf(os.Stderr, "[aurora-api] Startup configuration error: %v\n", err)
		os.Exit(1)
	}

	log := logger.Init(cfg)
	cfg.LogSummary(log)

	application, err := app.New(cfg, log)
	if err != nil {
		log.Error("Application initialization error", slog.Any("error", err))
		os.Exit(1)
	}

	serverErr := make(chan error, 1)
	go func() {
		log.Info("HTTP REST API Gateway listening",
			slog.String("address", application.Addr),
			slog.String("host", cfg.Server.Host),
			slog.Int("port", cfg.Server.Port),
		)
		if err := application.Server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErr <- err
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	select {
	case err := <-serverErr:
		log.Error("Server error encountered", slog.Any("error", err))
		os.Exit(1)
	case sig := <-quit:
		log.Info("Shutdown signal received, draining active connections...", slog.String("signal", sig.String()))
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		if err := application.Server.Shutdown(ctx); err != nil {
			log.Error("Server forced to shutdown", slog.Any("error", err))
			os.Exit(1)
		}
	}

	log.Info("Shutdown completed gracefully.")
}
