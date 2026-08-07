package tests

import (
	"os"
	"testing"

	"go-ingester/internal/config"
)

func setDummyEnv() {
	os.Setenv("AURORA_ENV", "development")
	os.Setenv("AURORA_LOG_LEVEL", "info")
	os.Setenv("MINIO_ENDPOINT", "http://minio:9000")
	os.Setenv("MINIO_BUCKET", "aurora")
	os.Setenv("NATS_URL", "nats://nats:4222")
	os.Setenv("AURORA_INGEST_CONCURRENCY", "4")
	os.Setenv("AURORA_BRONZE_MAX_BYTES", "53687091200")
	os.Setenv("AURORA_BRONZE_HIGH_WATERMARK", "0.90")
	os.Setenv("AURORA_BRONZE_LOW_WATERMARK", "0.60")
}

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

func TestLoadRequiredEnv(t *testing.T) {
	setDummyEnv()
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("failed to load config: %v", err)
	}
	if cfg.Ingest.Concurrency != 4 {
		t.Errorf("expected concurrency 4, got %d", cfg.Ingest.Concurrency)
	}

	os.Unsetenv("AURORA_ENV")
	if _, err := config.Load(); err == nil {
		t.Fatal("expected error when AURORA_ENV is missing, got nil")
	}
}
