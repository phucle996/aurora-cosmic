package config

import "fmt"

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
	cfg := &Config{
		Core: CoreConfig{
			Env:      getEnv("AURORA_ENV", "development"),
			LogLevel: getEnv("AURORA_LOG_LEVEL", "info"),
		},
		Server: ServerConfig{
			Host: getEnv("AURORA_API_HOST", "0.0.0.0"),
			Port: getEnvInt("AURORA_API_PORT", 8080),
		},
		MinIO: MinIOConfig{
			Endpoint: getEnv("MINIO_ENDPOINT", "http://minio:9000"),
			Bucket:   getEnv("MINIO_BUCKET", "aurora"),
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
