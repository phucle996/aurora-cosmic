package main

import (
	"fmt"
	"os"

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

	if err := app.Run(cfg); err != nil {
		fmt.Fprintf(os.Stderr, "[aurora-api] Runtime error: %v\n", err)
		os.Exit(1)
	}
}
