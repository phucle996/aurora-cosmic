package handler

import (
	"net/http"
	"strconv"
	"strings"

	"go-api/internal/domain/entity"
	"go-api/internal/domain/service"

	"github.com/gin-gonic/gin"
)

type IngestHandler struct{ ingest service.Ingest }

func NewIngestHandler(ingest service.Ingest) *IngestHandler { return &IngestHandler{ingest: ingest} }

func (h *IngestHandler) Status(c *gin.Context) {
	status, err := h.ingest.Status(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "ingest status unavailable"})
		return
	}
	c.JSON(http.StatusOK, status)
}

func (h *IngestHandler) Storage(c *gin.Context) {
	limit := 100
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 200 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "limit must be between 1 and 200"})
			return
		}
		limit = parsed
	}
	listing, err := h.ingest.Storage(c.Request.Context(), c.Query("prefix"), limit)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "storage listing unavailable"})
		return
	}
	c.JSON(http.StatusOK, listing)
}

func (h *IngestHandler) Start(c *gin.Context) {
	var request entity.IngestStartRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid ingest start request"})
		return
	}
	if request.ManifestPath == "" && request.Sector <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "sector or manifest_path is required"})
		return
	}
	job, err := h.ingest.Start(c.Request.Context(), request)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "ingester control unavailable"})
		return
	}
	c.JSON(http.StatusAccepted, job)
}

func (h *IngestHandler) Cancel(c *gin.Context) {
	job, err := h.ingest.Cancel(c.Request.Context(), strings.TrimSpace(c.Param("job_id")))
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "ingester control unavailable"})
		return
	}
	c.JSON(http.StatusAccepted, job)
}
