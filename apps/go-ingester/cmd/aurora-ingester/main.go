package main

import (
	"fmt"
	"os"

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

	if err := app.Run(cfg); err != nil {
		fmt.Fprintf(os.Stderr, "[aurora-ingester] Runtime error: %v\n", err)
		os.Exit(1)
	}
}
