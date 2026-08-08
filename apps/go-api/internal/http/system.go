package http

import (
	"net/http"
	"runtime"
	"time"
)

func (r *Router) handleSystemHealth(w http.ResponseWriter, req *http.Request) {
	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)
	subsystems, ready := r.dependencyStatus(req)
	status := "DEGRADED"
	if ready {
		status = "HEALTHY"
	}

	code := http.StatusOK
	if !ready {
		code = http.StatusServiceUnavailable
	}
	writeJSON(w, code, map[string]any{
		"status":      status,
		"version":     "0.1.0",
		"goroutines":  runtime.NumGoroutine(),
		"alloc_bytes": mem.Alloc,
		"uptime_sec":  time.Since(startTime).Seconds(),
		"subsystems":  subsystems,
	})
}

var startTime = time.Now()
