package config

import (
	"os"
	"testing"
)

func TestConfigValidation(t *testing.T) {
	cfg := &Config{
		IngestConcurrency:   4,
		BronzeLowWatermark:  0.60,
		BronzeHighWatermark: 0.90,
	}
	if err := cfg.Validate(); err != nil {
		t.Fatalf("expected valid config, got error: %v", err)
	}

	cfgInvalidConcurrency := &Config{
		IngestConcurrency:   0,
		BronzeLowWatermark:  0.60,
		BronzeHighWatermark: 0.90,
	}
	if err := cfgInvalidConcurrency.Validate(); err == nil {
		t.Fatal("expected error for invalid concurrency 0, got nil")
	}

	cfgInvalidWatermarks := &Config{
		IngestConcurrency:   4,
		BronzeLowWatermark:  0.95,
		BronzeHighWatermark: 0.90,
	}
	if err := cfgInvalidWatermarks.Validate(); err == nil {
		t.Fatal("expected error when low watermark > high watermark, got nil")
	}
}

func TestLoadDefaults(t *testing.T) {
	os.Unsetenv("AURORA_INGEST_CONCURRENCY")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("failed to load default config: %v", err)
	}
	if cfg.IngestConcurrency != 4 {
		t.Errorf("expected default concurrency 4, got %d", cfg.IngestConcurrency)
	}
}
