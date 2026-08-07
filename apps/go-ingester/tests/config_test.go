package tests

import (
	"os"
	"testing"

	"github.com/aurora-cosmic/go-ingester/internal/config"
)

func TestConfigValidation(t *testing.T) {
	cfg := &config.Config{
		Ingest: config.IngestConfig{Concurrency: 4},
		Bronze: config.BronzeConfig{LowWatermark: 0.60, HighWatermark: 0.90},
	}
	if err := cfg.Validate(); err != nil {
		t.Fatalf("expected valid config, got error: %v", err)
	}

	cfgInvalidConcurrency := &config.Config{
		Ingest: config.IngestConfig{Concurrency: 0},
		Bronze: config.BronzeConfig{LowWatermark: 0.60, HighWatermark: 0.90},
	}
	if err := cfgInvalidConcurrency.Validate(); err == nil {
		t.Fatal("expected error for invalid concurrency 0, got nil")
	}

	cfgInvalidWatermarks := &config.Config{
		Ingest: config.IngestConfig{Concurrency: 4},
		Bronze: config.BronzeConfig{LowWatermark: 0.95, HighWatermark: 0.90},
	}
	if err := cfgInvalidWatermarks.Validate(); err == nil {
		t.Fatal("expected error when low watermark > high watermark, got nil")
	}
}

func TestLoadDefaults(t *testing.T) {
	os.Unsetenv("AURORA_INGEST_CONCURRENCY")
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("failed to load default config: %v", err)
	}
	if cfg.Ingest.Concurrency != 4 {
		t.Errorf("expected default concurrency 4, got %d", cfg.Ingest.Concurrency)
	}
}
