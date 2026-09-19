package handler

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"go-api/internal/domain/entity"
	"go-api/internal/domain/service"

	"github.com/gin-gonic/gin"
)

const (
	minEnrichmentIdleFlush = 60
	maxEnrichmentIdleFlush = 900
	maxEnrichmentBatchSize = 5000
)

type EnrichmentControlHandler struct {
	enrichment service.EnrichmentControl
}

func NewEnrichmentControlHandler(enrichment service.EnrichmentControl) *EnrichmentControlHandler {
	return &EnrichmentControlHandler{enrichment: enrichment}
}

// GetControlOverview handles GET /api/v1/enrichment/control, returning both desired control state
// and live worker runtime status.
func (h *EnrichmentControlHandler) GetControlOverview(c *gin.Context) {
	overview, err := h.enrichment.GetControlOverview(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, overview)
}

func (h *EnrichmentControlHandler) Start(c *gin.Context) {
	var request entity.EnrichmentControlStartRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid enrichment start request"})
		return
	}
	request.Mode = strings.ToUpper(strings.TrimSpace(request.Mode))
	if request.Mode != "STREAM" && request.Mode != "BATCH" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "enrichment mode must be stream or batch"})
		return
	}
	if request.IdleFlushSeconds < minEnrichmentIdleFlush || request.IdleFlushSeconds > maxEnrichmentIdleFlush {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("idle_flush_seconds must be between %d and %d", minEnrichmentIdleFlush, maxEnrichmentIdleFlush)})
		return
	}
	if request.MaxBatchRecords < 1 || request.MaxBatchRecords > maxEnrichmentBatchSize {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("max_batch_records must be between 1 and %d", maxEnrichmentBatchSize)})
		return
	}
	request.TicketID = strings.TrimSpace(request.TicketID)
	if request.TicketID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ticket_id is required"})
		return
	}
	if len(request.TicketID) > 128 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ticket_id must not exceed 128 characters"})
		return
	}
	result, err := h.enrichment.Start(c.Request.Context(), request)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusAccepted, result)
}

func (h *EnrichmentControlHandler) Stop(c *gin.Context) {
	result, err := h.enrichment.Stop(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusAccepted, result)
}

func (h *EnrichmentControlHandler) ListSnapshots(c *gin.Context) {
	limit := 100
	if rawLimit := strings.TrimSpace(c.Query("limit")); rawLimit != "" {
		parsed, err := strconv.Atoi(rawLimit)
		if err != nil || parsed < 1 || parsed > 200 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "limit must be between 1 and 200"})
			return
		}
		limit = parsed
	}
	snapshots, err := h.enrichment.ListSnapshots(c.Request.Context(), limit)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"snapshots": snapshots})
}

func (h *EnrichmentControlHandler) Snapshot(c *gin.Context) {
	snapshot, err := h.enrichment.Snapshot(c.Request.Context(), strings.TrimSpace(c.Param("snapshot_id")))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, snapshot)
}
