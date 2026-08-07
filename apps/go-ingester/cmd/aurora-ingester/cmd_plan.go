package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"time"

	"go-ingester/internal/config"
	"go-ingester/internal/manifest"
	"go-ingester/internal/mast"
)

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
