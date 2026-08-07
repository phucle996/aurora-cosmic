package logger

import (
	"os"
	"strings"

	"github.com/sirupsen/logrus"
)

var Log = logrus.New()

// Init initializes Logrus structured JSON logger for aurora-ingester.
func Init(logLevel, env string) *logrus.Logger {
	Log.SetOutput(os.Stdout)
	Log.SetFormatter(&logrus.JSONFormatter{
		TimestampFormat: "2006-01-02T15:04:05.000Z07:00",
	})

	level, err := logrus.ParseLevel(strings.ToLower(logLevel))
	if err != nil {
		level = logrus.InfoLevel
	}
	Log.SetLevel(level)

	Log.WithFields(logrus.Fields{
		"service": "aurora-ingester",
		"env":     env,
	}).Info("Structured logger initialized")

	return Log
}
