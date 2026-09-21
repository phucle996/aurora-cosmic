package handler

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"go-api/internal/domain/entity"
	"go-api/internal/domain/service"
)

// LakehouseHandler exposes HTTP endpoints for exploring and previewing Lakehouse objects.
type LakehouseHandler struct {
	lakehouse service.Lakehouse
}

// NewLakehouseHandler creates a new LakehouseHandler.
func NewLakehouseHandler(lakehouse service.Lakehouse) *LakehouseHandler {
	return &LakehouseHandler{lakehouse: lakehouse}
}

// Summary handles GET /api/v1/lakehouse/summary
func (h *LakehouseHandler) Summary(c *gin.Context) {
	summary, err := h.lakehouse.Summary(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, summary)
}

// List handles GET /api/v1/lakehouse/objects
func (h *LakehouseHandler) List(c *gin.Context) {
	prefix := strings.TrimSpace(c.Query("prefix"))
	search := strings.TrimSpace(c.Query("search"))

	page := 1
	if raw := strings.TrimSpace(c.Query("page")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err == nil && parsed > 0 {
			page = parsed
		}
	}

	limit := 25
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err == nil && parsed > 0 && parsed <= 200 {
			limit = parsed
		}
	}

	listing, err := h.lakehouse.List(c.Request.Context(), entity.LakehouseListingQuery{
		Prefix: prefix,
		Search: search,
		Page:   page,
		Limit:  limit,
	})
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, listing)
}

// Preview handles GET /api/v1/lakehouse/preview
func (h *LakehouseHandler) Preview(c *gin.Context) {
	key := strings.TrimSpace(c.Query("key"))
	if key == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "key query parameter is required"})
		return
	}
	if strings.Contains(key, "..") || strings.HasPrefix(key, "/") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid lakehouse object key"})
		return
	}

	offset := 0
	if raw := strings.TrimSpace(c.Query("offset")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err == nil && parsed >= 0 {
			offset = parsed
		}
	}

	limit := 25
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err == nil && parsed > 0 {
			if parsed > 50 {
				parsed = 50
			}
			limit = parsed
		}
	}

	search := strings.TrimSpace(c.Query("search"))

	preview, err := h.lakehouse.Preview(c.Request.Context(), entity.LakehousePreviewQuery{
		Key:    key,
		Offset: offset,
		Limit:  limit,
		Search: search,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, preview)
}
