package app

import (
	"fmt"

	"github.com/aurora-cosmic/go-ingester/internal/config"
)

func Run(cfg *config.Config) error {
	fmt.Printf("[aurora-ingester] Service runner started in '%s' environment.\n", cfg.Env)
	return nil
}
