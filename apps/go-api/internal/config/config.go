package config

import (
	"fmt"
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

type MinIOConfig struct {
	Endpoint string
	Bucket   string
}

type Config struct {
	Core   CoreConfig
	Server ServerConfig
	MinIO  MinIOConfig
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

	cfg := &Config{
		Core: CoreConfig{
			Env:      envName,
			LogLevel: logLevel,
		},
		Server: ServerConfig{
			Host: host,
			Port: port,
		},
		MinIO: MinIOConfig{
			Endpoint: minioEndpoint,
			Bucket:   minioBucket,
		},
	}

	if err := cfg.Validate(); err != nil {
		return nil, fmt.Errorf("config validation failed: %w", err)
	}

	return cfg, nil
}

func (c *Config) Validate() error {
	if c.Server.Port < 1 || c.Server.Port > 65535 {
		return fmt.Errorf("AURORA_API_PORT must be between 1 and 65535, got %d", c.Server.Port)
	}
	return nil
}

func (c *Config) LogSummary() {
	fmt.Printf("[aurora-api] Config: env=%s, log_level=%s, listen=%s:%d, minio=%s, bucket=%s\n",
		c.Core.Env, c.Core.LogLevel, c.Server.Host, c.Server.Port, c.MinIO.Endpoint, c.MinIO.Bucket)
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
		return 0, fmt.Errorf("invalid integer value for '%s': '%s'", key, val)
	}
	return i, nil
}
