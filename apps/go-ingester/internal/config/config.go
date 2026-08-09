package config

import (
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"time"
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

type MetricsConfig struct {
	Addr string
}

type ControlConfig struct {
	Addr string
}

type IngestConfig struct {
	Concurrency        int
	CheckpointInterval time.Duration
}

type BronzeConfig struct {
	MaxBytes           int64
	HighWatermarkBytes int64
	LowWatermarkBytes  int64
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
	Metrics  MetricsConfig
	Control  ControlConfig
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

	checkpointInterval, err := optionalEnvDuration("AURORA_CHECKPOINT_FLUSH_INTERVAL", 5*time.Second)
	if err != nil {
		return nil, err
	}

	highWMBytes, err := optionalEnvInt64("AURORA_BRONZE_HIGH_WATERMARK_BYTES", 48318382080) // 45 GiB
	if err != nil {
		return nil, err
	}

	lowWMBytes, err := optionalEnvInt64("AURORA_BRONZE_LOW_WATERMARK_BYTES", 32212254720) // 30 GiB
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
		Metrics: MetricsConfig{
			Addr: optionalEnv("AURORA_METRICS_ADDR", ":8081"),
		},
		Control: ControlConfig{Addr: optionalEnv("AURORA_INGEST_CONTROL_ADDR", ":8087")},
		Ingest: IngestConfig{
			Concurrency:        concurrency,
			CheckpointInterval: checkpointInterval,
		},
		Bronze: BronzeConfig{
			MaxBytes:           optionalEnvInt64OrDefault("AURORA_BRONZE_MAX_BYTES", 53687091200), // 50 GiB
			HighWatermarkBytes: highWMBytes,
			LowWatermarkBytes:  lowWMBytes,
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
	if c.Ingest.CheckpointInterval < 0 {
		return fmt.Errorf("AURORA_CHECKPOINT_FLUSH_INTERVAL must not be negative")
	}
	if c.Bronze.MaxBytes <= 0 {
		return fmt.Errorf("AURORA_BRONZE_MAX_BYTES must be > 0")
	}
	if c.Bronze.LowWatermarkBytes <= 0 {
		return fmt.Errorf("AURORA_BRONZE_LOW_WATERMARK_BYTES must be > 0")
	}
	if c.Bronze.LowWatermarkBytes >= c.Bronze.HighWatermarkBytes {
		return fmt.Errorf("AURORA_BRONZE_LOW_WATERMARK_BYTES (%d) must be < AURORA_BRONZE_HIGH_WATERMARK_BYTES (%d)",
			c.Bronze.LowWatermarkBytes, c.Bronze.HighWatermarkBytes)
	}
	if c.Bronze.HighWatermarkBytes >= c.Bronze.MaxBytes {
		return fmt.Errorf("AURORA_BRONZE_HIGH_WATERMARK_BYTES (%d) must be < AURORA_BRONZE_MAX_BYTES (%d)",
			c.Bronze.HighWatermarkBytes, c.Bronze.MaxBytes)
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

// optionalEnvInt64 returns the env var parsed as int64 or the given default.
func optionalEnvInt64(key string, defaultVal int64) (int64, error) {
	v := os.Getenv(key)
	if v == "" {
		return defaultVal, nil
	}
	i, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		return defaultVal, fmt.Errorf("invalid int64 value for '%s'", key)
	}
	return i, nil
}

// optionalEnvInt64OrDefault reads an env var as int64 with a default — never errors.
func optionalEnvInt64OrDefault(key string, defaultVal int64) int64 {
	v := os.Getenv(key)
	if v == "" {
		return defaultVal
	}
	i, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		return defaultVal
	}
	return i
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

func optionalEnvDuration(key string, defaultVal time.Duration) (time.Duration, error) {
	v := os.Getenv(key)
	if v == "" {
		return defaultVal, nil
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		return defaultVal, fmt.Errorf("invalid duration value for '%s': %w", key, err)
	}
	return d, nil
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
