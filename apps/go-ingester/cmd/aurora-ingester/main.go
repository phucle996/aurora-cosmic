package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"go-ingester/internal/app"
	"go-ingester/internal/config"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintf(os.Stderr, "[aurora-ingester] Startup configuration error: %v\n", err)
		os.Exit(1)
	}

	cfg.LogSummary()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM, syscall.SIGINT)
	defer stop()

	if err := app.Run(ctx, cfg); err != nil {
		fmt.Fprintf(os.Stderr, "[aurora-ingester] Runtime error: %v\n", err)
		os.Exit(1)
	}

	fmt.Println("[aurora-ingester] Shutdown completed gracefully.")
}
