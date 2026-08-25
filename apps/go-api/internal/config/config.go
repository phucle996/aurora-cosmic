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

type ServerConfig struct {
	Host string
	Port int
}

type MetricsConfig struct {
	Addr string
}

type MinIOConfig struct {
	Endpoint         string
	Bucket           string
	PredictionBucket string
	AccessKey        string
	SecretKey        string
}

type NATSConfig struct {
	URL string
}

type PrometheusConfig struct {
	URL string
}

type ClickHouseConfig struct {
	Endpoint string
	Database string
	User     string
	Password string
}

type Config struct {
	Core               CoreConfig
	Server             ServerConfig
	Metrics            MetricsConfig
	MinIO              MinIOConfig
	ClickHouse         ClickHouseConfig
	NATS               NATSConfig
	Prometheus         PrometheusConfig
	IngesterControlURL string
	CORSAllowedOrigin  string
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

	host, err := requireEnv("AURORA_API_HOST")
	if err != nil {
		return nil, err
	}

	port, err := requireEnvInt("AURORA_API_PORT")
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
	minioAccessKey := os.Getenv("MINIO_ACCESS_KEY")
	if minioAccessKey == "" {
		minioAccessKey = "minioadmin"
	}
	minioSecretKey := os.Getenv("MINIO_SECRET_KEY")
	if minioSecretKey == "" {
		minioSecretKey = "minioadmin"
	}

	clickHouseEndpoint, err := requireEnv("AURORA_CLICKHOUSE_ENDPOINT")
	if err != nil {
		return nil, err
	}

	clickHouseDatabase, err := requireEnv("AURORA_CLICKHOUSE_DATABASE")
	if err != nil {
		return nil, err
	}

	clickHouseUser, err := requireEnv("AURORA_CLICKHOUSE_USER")
	if err != nil {
		return nil, err
	}

	clickHousePassword, err := requireEnv("AURORA_CLICKHOUSE_PASSWORD")
	if err != nil {
		return nil, err
	}

	corsAllowedOrigin, err := requireEnv("AURORA_CORS_ALLOWED_ORIGIN")
	if err != nil {
		return nil, err
	}

	cfg := &Config{
		Core: CoreConfig{
			Env:      envName,
			LogLevel: logLevel,
		},
		Server: ServerConfig{
			Host: host,
			Port: port,
		},
		Metrics: MetricsConfig{
			Addr: getenvOrDefault("AURORA_API_METRICS_ADDR", ":8086"),
		},
		MinIO: MinIOConfig{
			Endpoint:         minioEndpoint,
			Bucket:           minioBucket,
			PredictionBucket: getenvOrDefault("AURORA_PREDICTION_BUCKET", minioBucket),
			AccessKey:        minioAccessKey,
			SecretKey:        minioSecretKey,
		},
		ClickHouse: ClickHouseConfig{
			Endpoint: clickHouseEndpoint,
			Database: clickHouseDatabase,
			User:     clickHouseUser,
			Password: clickHousePassword,
		},
		NATS:               NATSConfig{URL: getenvOrDefault("NATS_URL", "nats://nats:4222")},
		Prometheus:         PrometheusConfig{URL: getenvOrDefault("PROMETHEUS_URL", "http://prometheus:9090")},
		IngesterControlURL: getenvOrDefault("INGESTER_CONTROL_URL", "http://go-ingester:8087"),
		CORSAllowedOrigin:  corsAllowedOrigin,
	}

	if err := cfg.Validate(); err != nil {
		return nil, fmt.Errorf("config validation failed: %w", err)
	}

	return cfg, nil
}

func getenvOrDefault(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func (c *Config) Validate() error {
	if c.Server.Port < 1 || c.Server.Port > 65535 {
		return fmt.Errorf("AURORA_API_PORT must be between 1 and 65535, got %d", c.Server.Port)
	}
	if c.CORSAllowedOrigin == "*" {
		return fmt.Errorf("AURORA_CORS_ALLOWED_ORIGIN must be a specific origin")
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
