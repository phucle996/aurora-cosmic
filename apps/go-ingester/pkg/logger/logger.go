package logger

import (
	"log/slog"
	"os"
	"strings"

	"go-ingester/internal/config"
)

// Init initializes a structured JSON slog logger from config and sets it as
// the default logger. Returns the configured logger for explicit passing.
func Init(cfg *config.Config) *slog.Logger {
	level := parseLevel(cfg.Core.LogLevel)

	h := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: level})
	log := slog.New(h).With(
		slog.String("service", "aurora-ingester"),
		slog.String("env", cfg.Core.Env),
	)
	slog.SetDefault(log)

	log.Info("Structured logger initialized")
	return log
}

func parseLevel(s string) slog.Level {
	switch strings.ToLower(s) {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}
