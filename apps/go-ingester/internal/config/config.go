package config

import (
	"fmt"
	"log/slog"
	"os"
	"strconv"
)

type CoreConfig struct {
	Env      string
	LogLevel string
}

type MinIOConfig struct {
	Endpoint string
	Bucket   string
}

type NATSConfig struct {
	URL string
}

type IngestConfig struct {
	Concurrency int
}

type BronzeConfig struct {
	MaxBytes      int64
	HighWatermark float64
	LowWatermark  float64
}

type Config struct {
	Core   CoreConfig
	MinIO  MinIOConfig
	NATS   NATSConfig
	Ingest IngestConfig
	Bronze BronzeConfig
}

func Load() (*Config, error) {
	envName, err := requireEnv("AURORA_ENV")
	if err != nil {
		return nil, err
	}

	logLevel, err := requireEnv("AURORA_LOG_LEVEL")
	if err != nil {
		return nil, err
	}

	minioEndpoint, err := requireEnv("MINIO_ENDPOINT")
	if err != nil {
		return nil, err
	}

	minioBucket, err := requireEnv("MINIO_BUCKET")
	if err != nil {
		return nil, err
	}

	natsURL, err := requireEnv("NATS_URL")
	if err != nil {
		return nil, err
	}

	concurrency, err := requireEnvInt("AURORA_INGEST_CONCURRENCY")
	if err != nil {
		return nil, err
	}

	maxBytes, err := requireEnvInt64("AURORA_BRONZE_MAX_BYTES")
	if err != nil {
		return nil, err
	}

	highWM, err := requireEnvFloat("AURORA_BRONZE_HIGH_WATERMARK")
	if err != nil {
		return nil, err
	}

	lowWM, err := requireEnvFloat("AURORA_BRONZE_LOW_WATERMARK")
	if err != nil {
		return nil, err
	}

	cfg := &Config{
		Core: CoreConfig{
			Env:      envName,
			LogLevel: logLevel,
		},
		MinIO: MinIOConfig{
			Endpoint: minioEndpoint,
			Bucket:   minioBucket,
		},
		NATS: NATSConfig{
			URL: natsURL,
		},
		Ingest: IngestConfig{
			Concurrency: concurrency,
		},
		Bronze: BronzeConfig{
			MaxBytes:      maxBytes,
			HighWatermark: highWM,
			LowWatermark:  lowWM,
		},
	}

	if err := cfg.Validate(); err != nil {
		return nil, fmt.Errorf("config validation failed: %w", err)
	}

	return cfg, nil
}

func (c *Config) Validate() error {
	if c.Ingest.Concurrency < 1 {
		return fmt.Errorf("AURORA_INGEST_CONCURRENCY must be >= 1, got %d", c.Ingest.Concurrency)
	}
	if c.Bronze.LowWatermark <= 0 || c.Bronze.LowWatermark >= c.Bronze.HighWatermark || c.Bronze.HighWatermark > 1.0 {
		return fmt.Errorf("invalid watermarks: low (%f) must be > 0 and < high (%f) <= 1.0", c.Bronze.LowWatermark, c.Bronze.HighWatermark)
	}
	return nil
}

func (c *Config) LogSummary(log *slog.Logger) {
	log.Info("Configuration loaded",
		slog.String("env", c.Core.Env),
		slog.String("log_level", c.Core.LogLevel),
	)
}

func requireEnv(key string) (string, error) {
	val := os.Getenv(key)
	if val == "" {
		return "", fmt.Errorf("missing required environment variable '%s'", key)
	}
	return val, nil
}

func requireEnvInt(key string) (int, error) {
	val, err := requireEnv(key)
	if err != nil {
		return 0, err
	}
	i, err := strconv.Atoi(val)
	if err != nil {
		return 0, fmt.Errorf("invalid integer value for '%s'", key)
	}
	return i, nil
}

func requireEnvInt64(key string) (int64, error) {
	val, err := requireEnv(key)
	if err != nil {
		return 0, err
	}
	i, err := strconv.ParseInt(val, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid int64 value for '%s'", key)
	}
	return i, nil
}

func requireEnvFloat(key string) (float64, error) {
	val, err := requireEnv(key)
	if err != nil {
		return 0, err
	}
	f, err := strconv.ParseFloat(val, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid float value for '%s'", key)
	}
	return f, nil
}
