package config

import (
	"fmt"
	"os"
	"strconv"
)

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

func requireEnvInt64(key string) (int64, error) {
	val, err := requireEnv(key)
	if err != nil {
		return 0, err
	}
	i, err := strconv.ParseInt(val, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid int64 value for '%s': '%s'", key, val)
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
		return 0, fmt.Errorf("invalid float value for '%s': '%s'", key, val)
	}
	return f, nil
}
