package handler

import (
	"go-api/internal/domain/entity"
	"go-api/internal/domain/service"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

type MonitoringHandler struct{ monitoring service.Monitoring }

func NewMonitoringHandler(monitoring service.Monitoring) *MonitoringHandler {
	return &MonitoringHandler{monitoring: monitoring}
}

func (h *MonitoringHandler) Query(c *gin.Context) {
	duration := time.Hour
	if raw := strings.TrimSpace(c.Query("range")); raw != "" {
		parsed, err := time.ParseDuration(raw)
		if err != nil || parsed <= 0 || parsed > 24*time.Hour {
			c.JSON(http.StatusBadRequest, gin.H{"error": "range must be a positive duration up to 24h"})
			return
		}
		duration = parsed
	}

	step := time.Minute
	if raw := strings.TrimSpace(c.Query("step")); raw != "" {
		seconds, err := strconv.Atoi(raw)
		if err != nil || seconds < 15 || seconds > 900 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "step must be between 15 and 900 seconds"})
			return
		}
		step = time.Duration(seconds) * time.Second
	}

	window := entity.MonitoringWindow{Duration: duration, Step: step}
	tab := strings.TrimSpace(c.Query("tab"))
	if tab == "" {
		tab = "all"
	}
	if !isMonitoringTab(tab) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unknown monitoring tab"})
		return
	}
	components, err := h.monitoring.Query(c.Request.Context(), window, tab)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Prometheus monitoring is unavailable"})
		return
	}

	items := make([]gin.H, len(components))
	for i, comp := range components {
		mapPoints := func(points []entity.MonitoringPoint) []gin.H {
			out := make([]gin.H, len(points))
			for j, p := range points {
				point := gin.H{
					"timestamp": p.Timestamp,
					"value":     p.Value,
				}
				if len(p.Labels) > 0 {
					point["labels"] = p.Labels
				}
				out[j] = point
			}
			return out
		}
		metrics := make([]gin.H, len(comp.Metrics))
		for j, metric := range comp.Metrics {
			metrics[j] = gin.H{
				"key":    metric.Key,
				"name":   metric.Name,
				"unit":   metric.Unit,
				"kind":   metric.Kind,
				"points": mapPoints(metric.Points),
			}
		}
		items[i] = gin.H{
			"id":        comp.ID,
			"name":      comp.Name,
			"group":     comp.Group,
			"container": comp.Container,
			"status":    comp.Status,
			"metrics":   metrics,
		}
	}

	end := time.Now().UTC()
	c.JSON(http.StatusOK, gin.H{
		"source":       "prometheus",
		"tab":          tab,
		"range":        window.Duration.String(),
		"start":        end.Add(-window.Duration).Format(time.RFC3339),
		"end":          end.Format(time.RFC3339),
		"step_seconds": int64(window.Step / time.Second),
		"components":   items,
	})
}

func isMonitoringTab(tab string) bool {
	switch tab {
	case "all",
		"go-ingester",
		"rust-preprocessor",
		"python-ml-worker",
		"rust-inference",
		"gold-builder",
		"go-api",
		"dashboard",
		"minio",
		"nats",
		"clickhouse":
		return true
	default:
		return false
	}
}
