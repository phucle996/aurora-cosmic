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
