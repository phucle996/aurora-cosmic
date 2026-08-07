package logger

import (
	"os"
	"strings"

	"go-ingester/internal/config"

	"github.com/sirupsen/logrus"
)

var Log = logrus.New()

// Init initializes Logrus structured JSON logger using service Config.
func Init(cfg *config.Config) *logrus.Logger {
	Log.SetOutput(os.Stdout)
	Log.SetFormatter(&logrus.JSONFormatter{
		TimestampFormat: "2006-01-02T15:04:05.000Z07:00",
	})

	level, err := logrus.ParseLevel(strings.ToLower(cfg.Core.LogLevel))
	if err != nil {
		level = logrus.InfoLevel
	}
	Log.SetLevel(level)

	Log.WithFields(logrus.Fields{
		"service": "aurora-ingester",
		"env":     cfg.Core.Env,
	}).Info("Structured logger initialized")

	return Log
}
