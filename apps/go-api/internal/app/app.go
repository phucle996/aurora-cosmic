package app

import (
	"fmt"

	"go-api/internal/config"
)

func Run(cfg *config.Config) error {
	fmt.Printf("[aurora-api] API Server listening on %s:%d...\n", cfg.Server.Host, cfg.Server.Port)
	return nil
}
