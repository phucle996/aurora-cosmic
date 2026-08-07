package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"go-ingester/internal/app"
	"go-ingester/internal/checkpoint"
	"go-ingester/internal/config"
	"go-ingester/internal/events"
	"go-ingester/internal/ingest"
	"go-ingester/internal/logger"
	"go-ingester/internal/manifest"
	"go-ingester/internal/mast"
	"go-ingester/internal/storage"

	"github.com/google/uuid"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintf(os.Stderr, "[aurora-ingester] Startup configuration error: %v\n", err)
		os.Exit(1)
	}

	log := logger.Init(cfg)
	cfg.LogSummary(log)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM, syscall.SIGINT)
	defer stop()

	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: aurora-ingester <command> [options]")
		fmt.Fprintln(os.Stderr, "  plan     -- discover and create ingestion manifest")
		fmt.Fprintln(os.Stderr, "  ingest   -- stream products from manifest into MinIO Bronze")
		fmt.Fprintln(os.Stderr, "  status   -- display progress status of the current ingestion run")
		os.Exit(1)
	}

	switch os.Args[1] {
	case "plan":
		if err := runPlan(ctx, cfg, log, os.Args[2:]); err != nil {
			log.Error("plan command failed", slog.Any("error", err))
			os.Exit(1)
		}

	case "ingest":
		if err := runIngest(ctx, cfg, log, os.Args[2:]); err != nil {
			log.Error("ingest command failed", slog.Any("error", err))
			os.Exit(1)
		}

	case "status":
		if err := runStatus(ctx, cfg, log, os.Args[2:]); err != nil {
			log.Error("status command failed", slog.Any("error", err))
			os.Exit(1)
		}

	default:
		// Legacy: run the long-running ingester service.
		if err := app.Run(ctx, cfg, log); err != nil {
			log.Error("Runtime error encountered", slog.Any("error", err))
			os.Exit(1)
		}
		log.Info("Shutdown completed gracefully.")
	}
}

// runPlan executes the `aurora-ingester plan` subcommand.
func runPlan(ctx context.Context, cfg *config.Config, log *slog.Logger, args []string) error {
	fs := flag.NewFlagSet("plan", flag.ExitOnError)
	sector := fs.Int("sector", 0, "filter by TESS sector (0 = all)")
	limit := fs.Int("limit", 100, "max observations to discover")
	maxBytes := fs.Int64("max-bytes", 0, "optional manifest byte budget (0 = unlimited)")
	maxFFI := fs.Int("max-ffi", 0, "max FFI products to include (0 = unlimited)")
	output := fs.String("output", "manifest.json", "output path for manifest JSON")
	if err := fs.Parse(args); err != nil {
		return err
	}

	timeout, err := time.ParseDuration(cfg.MAST.Timeout)
	if err != nil {
		timeout = 30 * time.Second
	}

	client := mast.NewClient(cfg.MAST.APIURL, timeout)

	log.Info("mast: starting TESS discovery",
		slog.Int("sector", *sector),
		slog.Int("limit", *limit),
	)

	results, err := mast.DiscoverTESS(ctx, client, mast.DiscoverOptions{
		Sector:   *sector,
		Limit:    *limit,
		PageSize: cfg.MAST.PageSize,
	}, log)
	if err != nil {
		return fmt.Errorf("discovery: %w", err)
	}

	opts := manifest.SelectOptions{
		IncludeTPF:    cfg.Manifest.IncludeTPF,
		IncludeLC:     cfg.Manifest.IncludeLC,
		IncludeFFI:    cfg.Manifest.IncludeFFI,
		RequirePair:   cfg.Manifest.RequirePair,
		MaxSamples:    *limit,
		MaxFFI:        *maxFFI,
		MaxTotalBytes: *maxBytes,
	}

	log.Info("manifest: building ingestion plan")
	m, err := manifest.Build(results, opts)
	if err != nil {
		return fmt.Errorf("manifest build: %w", err)
	}

	if err := manifest.Write(m, *output); err != nil {
		return fmt.Errorf("manifest write: %w", err)
	}

	printPlanSummary(m, *output)
	return nil
}

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
	m, err := manifest.Read(*manifestPath)
	if err != nil {
		return fmt.Errorf("read manifest: %w", err)
	}

	var minioClient storage.Client
	var publisher events.Publisher
	var cpStore *checkpoint.Store
	var cpManager *checkpoint.Manager

	if !*dryRun {
		accessKey := optionalEnv("MINIO_ACCESS_KEY", "minioadmin")
		secretKey := optionalEnv("MINIO_SECRET_KEY", "minioadmin")

		mc, err := storage.NewMinIOClient(cfg.MinIO.Endpoint, accessKey, secretKey)
		if err != nil {
			return fmt.Errorf("minio client: %w", err)
		}
		minioClient = mc

		// Initialize Checkpoint Store
		cpStore = checkpoint.NewStore(minioClient, cfg.MinIO.Bucket)

		// Connect to NATS JetStream publisher. If connection fails, fail fast.
		pub, err := events.NewNATSPublisher(cfg.NATS.URL, 5*time.Second)
		if err != nil {
			log.Warn("nats: publisher init warning, continuing without events", slog.Any("error", err))
		} else {
			publisher = pub
			defer publisher.Close()
		}

		manifestHash := checkpoint.ComputeManifestHash(m)

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
			var allProducts []manifest.ManifestProduct
			for _, s := range m.Samples {
				if s.TargetPixel != nil {
					allProducts = append(allProducts, *s.TargetPixel)
				}
				if s.LightCurve != nil {
					allProducts = append(allProducts, *s.LightCurve)
				}
			}
			allProducts = append(allProducts, m.FFIs...)

			initCp := checkpoint.CreateNewInitialCheckpoint(runID, *manifestPath, manifestHash, allProducts)
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

// runStatus executes the `aurora-ingester status` subcommand.
func runStatus(ctx context.Context, cfg *config.Config, log *slog.Logger, args []string) error {
	accessKey := optionalEnv("MINIO_ACCESS_KEY", "minioadmin")
	secretKey := optionalEnv("MINIO_SECRET_KEY", "minioadmin")

	mc, err := storage.NewMinIOClient(cfg.MinIO.Endpoint, accessKey, secretKey)
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
		case checkpoint.StatePublished:
			published++
		case checkpoint.StateStored:
			stored++
		case checkpoint.StateFailed:
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

func printPlanSummary(m *manifest.Manifest, path string) {
	s := m.Statistics
	fmt.Println()
	fmt.Println("AURORA ingestion plan")
	fmt.Println()
	fmt.Printf("  paired samples:    %d\n", s.PairedCount)
	fmt.Printf("  TPF only:          %d\n", s.TPFOnlyCount)
	fmt.Printf("  LC only:           %d\n", s.LCOnlyCount)
	fmt.Printf("  FFI:               %d\n", s.FFICount)
	fmt.Println()
	fmt.Printf("  TPF data:          %s\n", humanBytes(s.TPFBytes))
	fmt.Printf("  LC data:           %s\n", humanBytes(s.LCBytes))
	fmt.Printf("  FFI data:          %s\n", humanBytes(s.FFIBytes))
	fmt.Println()
	fmt.Printf("  selected total:    %s\n", humanBytes(s.TotalBytes))
	fmt.Println()
	fmt.Printf("  manifest:          %s\n", path)
	fmt.Println()
}

func printResumeSummary(cp *checkpoint.Checkpoint) {
	published := 0
	stored := 0
	failed := 0
	remaining := 0

	for _, pc := range cp.Products {
		switch pc.State {
		case checkpoint.StatePublished:
			published++
		case checkpoint.StateStored:
			stored++
		case checkpoint.StateFailed:
			failed++
		default:
			remaining++
		}
	}

	fmt.Println()
	fmt.Println("AURORA ingestion resume")
	fmt.Println()
	fmt.Printf("  run_id:            %s\n", cp.RunID)
	fmt.Printf("  manifest products: %d\n", len(cp.Products))
	fmt.Printf("  already published: %d\n", published)
	fmt.Printf("  stored (pending):  %d\n", stored)
	fmt.Printf("  failed:            %d\n", failed)
	fmt.Printf("  remaining:         %d\n", remaining)
	fmt.Println()
}

func printIngestSummary(s *ingest.Summary) {
	fmt.Println()
	fmt.Println("AURORA ingestion summary")
	fmt.Println()
	fmt.Printf("  products planned:  %d\n", s.PlannedProducts)
	fmt.Printf("  stored:            %d\n", s.StoredCount)
	fmt.Printf("  events published:  %d\n", s.PublishedCount)
	fmt.Printf("  skipped:           %d\n", s.SkippedCount)
	fmt.Printf("  failed:            %d\n", s.FailedCount)
	if s.StoredEventFailedCount > 0 {
		fmt.Printf("  event failed:      %d\n", s.StoredEventFailedCount)
	}
	fmt.Println()
	fmt.Printf("  bytes stored:      %s\n", humanBytes(s.StoredBytes))
	fmt.Printf("  elapsed:           %s\n", s.Elapsed.Round(time.Millisecond))
	if s.ThroughputBps > 0 {
		fmt.Printf("  throughput:        %s/s\n", humanBytes(int64(s.ThroughputBps)))
	}
	fmt.Println()
}

func humanBytes(b int64) string {
	const (
		KiB = 1024
		MiB = 1024 * KiB
		GiB = 1024 * MiB
	)
	switch {
	case b >= GiB:
		return fmt.Sprintf("%.2f GiB", float64(b)/GiB)
	case b >= MiB:
		return fmt.Sprintf("%.1f MiB", float64(b)/MiB)
	case b >= KiB:
		return fmt.Sprintf("%.1f KiB", float64(b)/KiB)
	default:
		return fmt.Sprintf("%d B", b)
	}
}

func optionalEnv(key, defaultVal string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultVal
}
