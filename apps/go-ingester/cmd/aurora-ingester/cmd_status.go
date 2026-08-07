package main

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	storageinfra "go-ingester/infra/storage"
	"go-ingester/internal/config"
	"go-ingester/internal/model"
	"go-ingester/internal/pipeline/checkpoint"
)

// runStatus executes the `aurora-ingester status` subcommand.
func runStatus(ctx context.Context, cfg *config.Config, log *slog.Logger, args []string) error {
	_ = args
	log.Info("status: fetching current ingestion checkpoint")

	accessKey := optionalEnv("MINIO_ACCESS_KEY", "minioadmin")
	secretKey := optionalEnv("MINIO_SECRET_KEY", "minioadmin")

	mc, err := storageinfra.NewMinIOClient(cfg.MinIO.Endpoint, accessKey, secretKey)
	if err != nil {
		return fmt.Errorf("minio client: %w", err)
	}

	cpStore := checkpoint.NewStore(mc, cfg.MinIO.Bucket)
	cp, exists, err := cpStore.LoadCurrent(ctx)
	if err != nil {
		return fmt.Errorf("load current checkpoint: %w", err)
	}
	if !exists || cp == nil {
		fmt.Println("No active or past ingestion runs found.")
		return nil
	}

	published := 0
	stored := 0
	failed := 0
	planned := 0

	for _, pc := range cp.Products {
		switch pc.State {
		case model.StatePublished:
			published++
		case model.StateStored:
			stored++
		case model.StateFailed:
			failed++
		default:
			planned++
		}
	}

	fmt.Println()
	fmt.Println("AURORA ingestion status")
	fmt.Println()
	fmt.Printf("  run_id:            %s\n", cp.RunID)
	fmt.Printf("  status:            %s\n", cp.Status)
	fmt.Printf("  manifest_path:     %s\n", cp.ManifestPath)
	fmt.Printf("  manifest_hash:     %s\n", cp.ManifestHash[:12])
	fmt.Printf("  started_at:        %s\n", cp.StartedAt.Format(time.RFC3339))
	fmt.Printf("  updated_at:        %s\n", cp.UpdatedAt.Format(time.RFC3339))
	fmt.Println()
	fmt.Printf("  products planned:  %d\n", len(cp.Products))
	fmt.Printf("  published:         %d\n", published)
	fmt.Printf("  stored:            %d\n", stored)
	fmt.Printf("  failed:            %d\n", failed)
	fmt.Printf("  remaining:         %d\n", planned)
	fmt.Println()

	return nil
}
