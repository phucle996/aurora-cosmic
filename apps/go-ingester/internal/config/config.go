package config

import "fmt"

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
	cfg := &Config{
		Core: CoreConfig{
			Env:      getEnv("AURORA_ENV", "development"),
			LogLevel: getEnv("AURORA_LOG_LEVEL", "info"),
		},
		MinIO: MinIOConfig{
			Endpoint: getEnv("MINIO_ENDPOINT", "http://minio:9000"),
			Bucket:   getEnv("MINIO_BUCKET", "aurora"),
		},
		NATS: NATSConfig{
			URL: getEnv("NATS_URL", "nats://nats:4222"),
		},
		Ingest: IngestConfig{
			Concurrency: getEnvInt("AURORA_INGEST_CONCURRENCY", 4),
		},
		Bronze: BronzeConfig{
			MaxBytes:      getEnvInt64("AURORA_BRONZE_MAX_BYTES", 53687091200),
			HighWatermark: getEnvFloat("AURORA_BRONZE_HIGH_WATERMARK", 0.90),
			LowWatermark:  getEnvFloat("AURORA_BRONZE_LOW_WATERMARK", 0.60),
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

func (c *Config) LogSummary() {
	fmt.Printf("[aurora-ingester] Config: env=%s, log_level=%s, concurrency=%d, minio=%s, bucket=%s, nats=%s, high_wm=%.2f, low_wm=%.2f\n",
		c.Core.Env, c.Core.LogLevel, c.Ingest.Concurrency, c.MinIO.Endpoint, c.MinIO.Bucket, c.NATS.URL, c.Bronze.HighWatermark, c.Bronze.LowWatermark)
}
