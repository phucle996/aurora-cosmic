package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"time"

	eventsinfra "go-ingester/infra/events"
	"go-ingester/infra/mast"
	storageinfra "go-ingester/infra/storage"
	"go-ingester/internal/config"
	"go-ingester/internal/model"
	"go-ingester/internal/pipeline/checkpoint"
	"go-ingester/internal/pipeline/ingest"
	"go-ingester/internal/pipeline/plan"

	"github.com/google/uuid"
)

// runIngest executes the `aurora-ingester ingest` subcommand.
func runIngest(ctx context.Context, cfg *config.Config, log *slog.Logger, args []string) error {
	fs := flag.NewFlagSet("ingest", flag.ExitOnError)
	manifestPath := fs.String("manifest", "", "path to manifest JSON file")
	concurrency := fs.Int("concurrency", cfg.Ingest.Concurrency, "bounded download concurrency")
	dryRun := fs.Bool("dry-run", false, "print object paths without downloading")
	resume := fs.Bool("resume", false, "resume from existing matching checkpoint")
	fresh := fs.Bool("fresh", false, "force creation of a new checkpoint run")
	if err := fs.Parse(args); err != nil {
		return err
	}

	if *manifestPath == "" {
		return fmt.Errorf("missing required --manifest argument")
	}

	log.Info("manifest: loading ingestion plan", slog.String("path", *manifestPath))
	m, err := plan.Read(*manifestPath)
	if err != nil {
		return fmt.Errorf("read manifest: %w", err)
	}

	var minioClient model.Client
	var publisher model.Publisher
	var cpStore *checkpoint.Store
	var cpManager *checkpoint.Manager

	if !*dryRun {
		accessKey := optionalEnv("MINIO_ACCESS_KEY", "minioadmin")
		secretKey := optionalEnv("MINIO_SECRET_KEY", "minioadmin")

		mc, err := storageinfra.NewMinIOClient(cfg.MinIO.Endpoint, accessKey, secretKey)
		if err != nil {
			return fmt.Errorf("minio client: %w", err)
		}
		minioClient = mc

		// Initialize Checkpoint Store
		cpStore = checkpoint.NewStore(minioClient, cfg.MinIO.Bucket)

		// Connect to NATS JetStream publisher
		pub, err := eventsinfra.NewNATSPublisher(cfg.NATS.URL, 5*time.Second)
		if err != nil {
			log.Warn("nats: publisher init warning, continuing without events", slog.Any("error", err))
		} else {
			publisher = pub
			defer publisher.Close()
		}

		manifestHash := model.ComputeManifestHash(m)

		// Checkpoint initialization & resume decision
		if !*fresh {
			existingCp, exists, loadErr := cpStore.LoadCurrent(ctx)
			if loadErr == nil && exists && existingCp != nil {
				if existingCp.ManifestHash == manifestHash || *resume {
					log.Info("checkpoint: resuming existing run",
						slog.String("run_id", existingCp.RunID),
						slog.String("status", string(existingCp.Status)),
					)
					cpManager = checkpoint.NewManager(cpStore, existingCp)
					printResumeSummary(existingCp)
				}
			}
		}

		if cpManager == nil {
			runID := fmt.Sprintf("ingest-%s", uuid.NewString()[:8])
			initCp := model.CreateNewInitialCheckpoint(runID, *manifestPath, manifestHash, m.Products())
			cpManager = checkpoint.NewManager(cpStore, initCp)
			log.Info("checkpoint: created fresh ingestion run", slog.String("run_id", runID))
		}
	}

	timeout, err := time.ParseDuration(cfg.MAST.Timeout)
	if err != nil {
		timeout = 30 * time.Second
	}

	mastClient := mast.NewClient(cfg.MAST.APIURL, timeout)
	pipeline := ingest.NewPipeline(mastClient, minioClient, publisher, cpManager, cfg.MinIO.Bucket, *concurrency, log)
	pipeline.SetCheckpointInterval(cfg.Ingest.CheckpointInterval)
	pipeline.SetMaxRunBytes(cfg.Bronze.MaxBytes)

	log.Info("ingest: starting pipeline run",
		slog.Int("concurrency", *concurrency),
		slog.Bool("dry_run", *dryRun),
	)

	summary, results, err := pipeline.IngestManifest(ctx, m, *dryRun)
	if err != nil {
		return fmt.Errorf("pipeline execution: %w", err)
	}

	printIngestSummary(summary)

	if summary.FailedCount > 0 {
		return fmt.Errorf("ingestion completed with %d failures", summary.FailedCount)
	}

	_ = results
	return nil
}

func optionalEnv(key, defaultVal string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultVal
}
