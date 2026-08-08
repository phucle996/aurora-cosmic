package handler

import (
	"go-api/internal/domain/service"
	"net/http"
	"runtime"
	"time"

	"github.com/gin-gonic/gin"
)

type SystemHandler struct {
	readiness service.Readiness
	started   time.Time
}

func NewSystemHandler(readiness service.Readiness) *SystemHandler {
	return &SystemHandler{readiness: readiness, started: time.Now()}
}

func (h *SystemHandler) Healthz(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status":    "UP",
		"service":   "aurora-api",
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
}

func (h *SystemHandler) Readyz(c *gin.Context) {
	subsystems, ready := h.readiness.Check(c.Request.Context())
	status, code := "READY", http.StatusOK
	if !ready {
		status, code = "NOT_READY", http.StatusServiceUnavailable
	}
	c.JSON(code, gin.H{
		"status":     status,
		"service":    "aurora-api",
		"subsystems": subsystems,
	})
}

func (h *SystemHandler) System(c *gin.Context) {
	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)
	subsystems, ready := h.readiness.Check(c.Request.Context())
	status, code := "HEALTHY", http.StatusOK
	if !ready {
		status, code = "DEGRADED", http.StatusServiceUnavailable
	}
	c.JSON(code, gin.H{
		"status":      status,
		"version":     "0.1.0",
		"goroutines":  runtime.NumGoroutine(),
		"alloc_bytes": mem.Alloc,
		"uptime_sec":  time.Since(h.started).Seconds(),
		"subsystems":  subsystems,
	})
}
