package app

import (
	"fmt"

	"github.com/aurora-cosmic/go-api/internal/config"
)

func Run(cfg *config.Config) error {
	fmt.Printf("[aurora-api] API Server listening on %s:%d...\n", cfg.Host, cfg.Port)
	return nil
}
