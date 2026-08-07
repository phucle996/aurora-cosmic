package config

import (
	"fmt"
	"os"
	"strconv"
)

type Config struct {
	Env           string
	LogLevel      string
	Host          string
	Port          int
	MinIOEndpoint string
	MinIOBucket   string
}

func Load() (*Config, error) {
	cfg := &Config{
		Env:           getEnv("AURORA_ENV", "development"),
		LogLevel:      getEnv("AURORA_LOG_LEVEL", "info"),
		Host:          getEnv("AURORA_API_HOST", "0.0.0.0"),
		Port:          getEnvInt("AURORA_API_PORT", 8080),
		MinIOEndpoint: getEnv("MINIO_ENDPOINT", "http://minio:9000"),
		MinIOBucket:   getEnv("MINIO_BUCKET", "aurora"),
	}

	if err := cfg.Validate(); err != nil {
		return nil, fmt.Errorf("config validation failed: %w", err)
	}

	return cfg, nil
}

func (c *Config) Validate() error {
	if c.Port < 1 || c.Port > 65535 {
		return fmt.Errorf("AURORA_API_PORT must be between 1 and 65535, got %d", c.Port)
	}
	return nil
}

func (c *Config) LogSummary() {
	fmt.Printf("[aurora-api] Config: env=%s, log_level=%s, listen=%s:%d, minio=%s, bucket=%s\n",
		c.Env, c.LogLevel, c.Host, c.Port, c.MinIOEndpoint, c.MinIOBucket)
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
