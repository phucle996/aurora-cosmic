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

type MASTConfig struct {
	APIURL   string
	Timeout  string
	PageSize int
}

type ManifestConfig struct {
	IncludeTPF  bool
	IncludeLC   bool
	IncludeFFI  bool
	RequirePair bool
}

type Config struct {
	Core     CoreConfig
	MinIO    MinIOConfig
	NATS     NATSConfig
	Ingest   IngestConfig
	Bronze   BronzeConfig
	MAST     MASTConfig
	Manifest ManifestConfig
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

	// MAST configuration — optional, fallback to defaults if not set.
	mastURL := optionalEnv("MAST_API_URL", "https://mast.stsci.edu/api/v0/invoke")
	mastTimeout := optionalEnv("MAST_TIMEOUT", "30s")
	mastPageSize, _ := optionalEnvInt("MAST_PAGE_SIZE", 1000)

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
		MAST: MASTConfig{
			APIURL:   mastURL,
			Timeout:  mastTimeout,
			PageSize: mastPageSize,
		},
		Manifest: ManifestConfig{
			IncludeTPF:  optionalEnvBool("AURORA_INCLUDE_TPF", true),
			IncludeLC:   optionalEnvBool("AURORA_INCLUDE_LIGHTCURVE", true),
			IncludeFFI:  optionalEnvBool("AURORA_INCLUDE_FFI", true),
			RequirePair: optionalEnvBool("AURORA_REQUIRE_TPF_LC_PAIR", true),
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

// optionalEnv returns the env var value or the given default when unset.
func optionalEnv(key, defaultVal string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultVal
}

// optionalEnvInt returns the env var parsed as int or the given default.
func optionalEnvInt(key string, defaultVal int) (int, error) {
	v := os.Getenv(key)
	if v == "" {
		return defaultVal, nil
	}
	i, err := strconv.Atoi(v)
	if err != nil {
		return defaultVal, fmt.Errorf("invalid integer value for '%s'", key)
	}
	return i, nil
}

// optionalEnvBool returns the env var parsed as bool or the given default.
// Accepted true values: "true", "1", "yes".
func optionalEnvBool(key string, defaultVal bool) bool {
	v := os.Getenv(key)
	if v == "" {
		return defaultVal
	}
	switch v {
	case "true", "1", "yes":
		return true
	case "false", "0", "no":
		return false
	}
	return defaultVal
}
