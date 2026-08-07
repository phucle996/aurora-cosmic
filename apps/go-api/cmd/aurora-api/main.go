package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"go-api/internal/app"
	"go-api/internal/config"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintf(os.Stderr, "[aurora-api] Startup configuration error: %v\n", err)
		os.Exit(1)
	}

	cfg.LogSummary()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM, syscall.SIGINT)
	defer stop()

	if err := app.Run(ctx, cfg); err != nil {
		fmt.Fprintf(os.Stderr, "[aurora-api] Runtime error: %v\n", err)
		os.Exit(1)
	}

	fmt.Println("[aurora-api] Shutdown completed gracefully.")
}
