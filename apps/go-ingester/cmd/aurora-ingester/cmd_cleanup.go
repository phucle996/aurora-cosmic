package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log/slog"
	"os"

	storageinfra "go-ingester/infra/storage"
	"go-ingester/internal/config"
	"go-ingester/internal/pipeline/lifecycle"
)

// runCleanup executes the `aurora-ingester cleanup` subcommand.
//
// Usage:
//
//	aurora-ingester cleanup [--dry-run] [--json]
//
// --dry-run  Show what would be deleted without calling DeleteObject.
// --json     Output machine-readable JSON result.
func runCleanup(ctx context.Context, cfg *config.Config, log *slog.Logger, args []string) error {
	fs := flag.NewFlagSet("cleanup", flag.ExitOnError)
	dryRun := fs.Bool("dry-run", false, "show what would be deleted without calling DeleteObject")
	jsonOut := fs.Bool("json", false, "output machine-readable JSON")
	if err := fs.Parse(args); err != nil {
		return err
	}

	accessKey := optionalEnv("MINIO_ACCESS_KEY", "minioadmin")
	secretKey := optionalEnv("MINIO_SECRET_KEY", "minioadmin")

	mc, err := storageinfra.NewMinIOClient(cfg.MinIO.Endpoint, accessKey, secretKey)
	if err != nil {
		return fmt.Errorf("minio client: %w", err)
	}

	policy := lifecycle.Policy{
		MaxBytes:           cfg.Bronze.MaxBytes,
		HighWatermarkBytes: cfg.Bronze.HighWatermarkBytes,
		LowWatermarkBytes:  cfg.Bronze.LowWatermarkBytes,
	}

	adapter := buildMinIOAdapter(mc)
	mgr, err := lifecycle.NewManager(adapter, cfg.MinIO.Bucket, policy, log)
	if err != nil {
		return fmt.Errorf("lifecycle manager: %w", err)
	}

	result, err := mgr.RunCleanup(ctx, *dryRun)
	if err != nil {
		return fmt.Errorf("cleanup failed: %w", err)
	}

	if *jsonOut {
		return printCleanupJSON(result)
	}
	printCleanupText(result, policy, log)
	return nil
}

// printCleanupText renders a human-readable cleanup report.
func printCleanupText(r *lifecycle.EvictionResult, p lifecycle.Policy, log *slog.Logger) {
	prefix := ""
	if r.DryRun {
		prefix = "[DRY RUN] "
	}

	fmt.Printf("\n%sBronze Cleanup Report\n", prefix)
	fmt.Printf("  Usage before : %s\n", lifecycle.FormatBytes(r.UsageBefore))
	fmt.Printf("  Usage after  : %s\n", lifecycle.FormatBytes(r.UsageAfter))
	fmt.Printf("  HIGH         : %s\n", lifecycle.FormatBytes(p.HighWatermarkBytes))
	fmt.Printf("  LOW          : %s\n", lifecycle.FormatBytes(p.LowWatermarkBytes))
	fmt.Printf("  MAX          : %s\n", lifecycle.FormatBytes(p.MaxBytes))
	fmt.Printf("  Deleted      : %d objects (%s)\n", r.ObjectsDeleted, lifecycle.FormatBytes(r.BytesDeleted))
	fmt.Printf("  Blocked      : %d candidates\n", len(r.Blocked))
	fmt.Printf("  Target reached: %v\n", r.TargetReached)

	if len(r.Blocked) > 0 {
		fmt.Println("\n  Blocked candidates:")
		for _, b := range r.Blocked {
			fmt.Printf("    [%s] %s — %s\n", b.LineageID[:8], b.BronzeObjectKey, b.Reason)
		}
	}

	if !r.TargetReached {
		log.Warn("storage pressure unresolved",
			slog.String("status", "INSUFFICIENT_EVICTABLE_CAPACITY"),
			slog.Int64("usage_after", r.UsageAfter),
			slog.Int64("target", p.LowWatermarkBytes),
		)
	}
}

// printCleanupJSON renders the cleanup result as JSON to stdout.
func printCleanupJSON(r *lifecycle.EvictionResult) error {
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	return enc.Encode(r)
}

// buildMinIOAdapter wraps a concrete MinIOClient into the lifecycle.MinIOAdapter.
func buildMinIOAdapter(mc *storageinfra.MinIOClient) *lifecycle.MinIOAdapter {
	return &lifecycle.MinIOAdapter{
		ListBronzeUsageFn: mc.ListBronzeUsage,
		ListLineageKeysFn: mc.ListLineageKeys,
		GetJSONObjectFn:   mc.GetJSONObject,
		PutJSONObjectFn:   mc.PutJSONObject,
		DeleteObjectFn:    mc.DeleteObject,
		StatObjectExistsFn: func(ctx context.Context, bucket, objectKey string) (int64, bool, error) {
			info, exists, err := mc.StatObject(ctx, bucket, objectKey)
			if err != nil || !exists {
				return 0, exists, err
			}
			return info.Size, true, nil
		},
	}
}
