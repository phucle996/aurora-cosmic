package http

import (
	"net/http"
	"runtime"
	"time"
)

func handleSystemHealth(w http.ResponseWriter, req *http.Request) {
	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)

	writeJSON(w, http.StatusOK, map[string]any{
		"status":      "HEALTHY",
		"version":     "0.1.0",
		"goroutines":  runtime.NumGoroutine(),
		"alloc_bytes": mem.Alloc,
		"uptime_sec":  time.Since(startTime).Seconds(),
		"subsystems": map[string]string{
			"storage_minio": "CONNECTED",
			"query_engine":  "READY",
			"ml_inference":  "STANDBY",
		},
	})
}

var startTime = time.Now()
