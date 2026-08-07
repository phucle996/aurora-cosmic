package tests

import (
	"os"
	"testing"

	"go-api/internal/config"
)

func setDummyEnv() {
	os.Setenv("AURORA_ENV", "development")
	os.Setenv("AURORA_LOG_LEVEL", "info")
	os.Setenv("AURORA_API_HOST", "0.0.0.0")
	os.Setenv("AURORA_API_PORT", "8080")
	os.Setenv("MINIO_ENDPOINT", "http://minio:9000")
	os.Setenv("MINIO_BUCKET", "aurora")
}

func TestConfigValidation(t *testing.T) {
	cfg := &config.Config{Server: config.ServerConfig{Port: 8080}}
	if err := cfg.Validate(); err != nil {
		t.Fatalf("expected valid config, got: %v", err)
	}

	cfgInvalidPort := &config.Config{Server: config.ServerConfig{Port: 70000}}
	if err := cfgInvalidPort.Validate(); err == nil {
		t.Fatal("expected error for port 70000, got nil")
	}
}

func TestLoadRequiredEnv(t *testing.T) {
	setDummyEnv()
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("failed to load config: %v", err)
	}
	if cfg.Server.Port != 8080 {
		t.Errorf("expected port 8080, got %d", cfg.Server.Port)
	}

	os.Unsetenv("AURORA_ENV")
	if _, err := config.Load(); err == nil {
		t.Fatal("expected error when AURORA_ENV is missing, got nil")
	}
}
