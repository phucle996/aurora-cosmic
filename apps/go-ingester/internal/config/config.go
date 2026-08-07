package config

import (
	"fmt"
	"os"
	"strconv"
)

type Config struct {
	Env                   string
	LogLevel              string
	MinIOEndpoint         string
	MinIOBucket           string
	NATSUrl               string
	IngestConcurrency     int
	BronzeMaxBytes        int64
	BronzeHighWatermark   float64
	BronzeLowWatermark    float64
}

func Load() (*Config, error) {
	cfg := &Config{
		Env:                 getEnv("AURORA_ENV", "development"),
		LogLevel:            getEnv("AURORA_LOG_LEVEL", "info"),
		MinIOEndpoint:       getEnv("MINIO_ENDPOINT", "http://minio:9000"),
		MinIOBucket:         getEnv("MINIO_BUCKET", "aurora"),
		NATSUrl:             getEnv("NATS_URL", "nats://nats:4222"),
		IngestConcurrency:   getEnvInt("AURORA_INGEST_CONCURRENCY", 4),
		BronzeMaxBytes:      getEnvInt64("AURORA_BRONZE_MAX_BYTES", 53687091200),
		BronzeHighWatermark: getEnvFloat("AURORA_BRONZE_HIGH_WATERMARK", 0.90),
		BronzeLowWatermark:  getEnvFloat("AURORA_BRONZE_LOW_WATERMARK", 0.60),
	}

	if err := cfg.Validate(); err != nil {
		return nil, fmt.Errorf("config validation failed: %w", err)
	}

	return cfg, nil
}

func (c *Config) Validate() error {
	if c.IngestConcurrency < 1 {
		return fmt.Errorf("AURORA_INGEST_CONCURRENCY must be >= 1, got %d", c.IngestConcurrency)
	}
	if c.BronzeLowWatermark <= 0 || c.BronzeLowWatermark >= c.BronzeHighWatermark || c.BronzeHighWatermark > 1.0 {
		return fmt.Errorf("invalid watermarks: low (%f) must be > 0 and < high (%f) <= 1.0", c.BronzeLowWatermark, c.BronzeHighWatermark)
	}
	return nil
}

func (c *Config) LogSummary() {
	fmt.Printf("[aurora-ingester] Config: env=%s, log_level=%s, concurrency=%d, minio=%s, bucket=%s, nats=%s, high_wm=%.2f, low_wm=%.2f\n",
		c.Env, c.LogLevel, c.IngestConcurrency, c.MinIOEndpoint, c.MinIOBucket, c.NATSUrl, c.BronzeHighWatermark, c.BronzeLowWatermark)
}

func getEnv(key, fallback string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if val := os.Getenv(key); val != "" {
		if i, err := strconv.Atoi(val); err == nil {
			return i
		}
	}
	return fallback
}

func getEnvInt64(key string, fallback int64) int64 {
	if val := os.Getenv(key); val != "" {
		if i, err := strconv.ParseInt(val, 10, 64); err == nil {
			return i
		}
	}
	return fallback
}

func getEnvFloat(key string, fallback float64) float64 {
	if val := os.Getenv(key); val != "" {
		if f, err := strconv.ParseFloat(val, 64); err == nil {
			return f
		}
	}
	return fallback
}
