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
	"go-ingester/internal/config"
	"go-ingester/internal/logger"
	"go-ingester/internal/manifest"
	"go-ingester/internal/mast"
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
		os.Exit(1)
	}

	switch os.Args[1] {
	case "plan":
		if err := runPlan(ctx, cfg, log, os.Args[2:]); err != nil {
			log.Error("plan command failed", slog.Any("error", err))
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
	sector   := fs.Int("sector", 0, "filter by TESS sector (0 = all)")
	limit    := fs.Int("limit", 100, "max observations to discover")
	maxBytes := fs.Int64("max-bytes", 0, "optional manifest byte budget (0 = unlimited)")
	maxFFI   := fs.Int("max-ffi", 0, "max FFI products to include (0 = unlimited)")
	output   := fs.String("output", "manifest.json", "output path for manifest JSON")
	if err := fs.Parse(args); err != nil {
		return err
	}

	// Parse MAST timeout.
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

// printPlanSummary prints a human-readable ingestion plan summary to stdout.
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
