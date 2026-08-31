package handler

import (
	"net/http"
	"strconv"
	"strings"

	"go-api/internal/domain/entity"
	"go-api/internal/domain/service"

	"github.com/gin-gonic/gin"
)

type GoldControlHandler struct{ gold service.GoldControl }

func NewGoldControlHandler(gold service.GoldControl) *GoldControlHandler {
	return &GoldControlHandler{gold: gold}
}

func (h *GoldControlHandler) Query(c *gin.Context) {
	overview, err := h.gold.Query(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, overview)
}

func (h *GoldControlHandler) Start(c *gin.Context) {
	var request entity.GoldControlStartRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid Gold start request"})
		return
	}
	overview, err := h.gold.Start(c.Request.Context(), request)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusAccepted, overview)
}

func (h *GoldControlHandler) Stop(c *gin.Context) {
	overview, err := h.gold.Stop(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusAccepted, overview)
}

func (h *GoldControlHandler) ResolveLineage(c *gin.Context) {
	var request entity.GoldLineageResolveRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid Gold lineage request"})
		return
	}
	if len(request.Inputs) > 100 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "at most 100 Gold lineage inputs are allowed"})
		return
	}
	resolutions, err := h.gold.ResolveLineage(c.Request.Context(), request.Inputs)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": resolutions})
}

func (h *GoldControlHandler) ListSnapshots(c *gin.Context) {
	limit := 100
	if rawLimit := strings.TrimSpace(c.Query("limit")); rawLimit != "" {
		parsed, err := strconv.Atoi(rawLimit)
		if err != nil || parsed < 1 || parsed > 200 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "limit must be between 1 and 200"})
			return
		}
		limit = parsed
	}
	snapshots, err := h.gold.ListSnapshots(c.Request.Context(), limit)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"snapshots": snapshots})
}

func (h *GoldControlHandler) Snapshot(c *gin.Context) {
	snapshot, err := h.gold.Snapshot(c.Request.Context(), strings.TrimSpace(c.Param("snapshot_id")))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, snapshot)
}

func (h *GoldControlHandler) Artifact(c *gin.Context) {
	sector, err := strconv.Atoi(c.Param("sector"))
	if err != nil || sector < 1 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "sector must be a positive integer"})
		return
	}
	query := entity.GoldArtifactPreviewQuery{Limit: 25}
	if rawLimit := strings.TrimSpace(c.Query("limit")); rawLimit != "" {
		query.Limit, err = strconv.Atoi(rawLimit)
		if err != nil || query.Limit < 1 || query.Limit > 50 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "limit must be between 1 and 50"})
			return
		}
	}
	if rawOffset := strings.TrimSpace(c.Query("offset")); rawOffset != "" {
		query.Offset, err = strconv.Atoi(rawOffset)
		if err != nil || query.Offset < 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "offset must be a non-negative integer"})
			return
		}
	}
	query.Search = strings.TrimSpace(c.Query("search"))
	query.FilterColumn = strings.TrimSpace(c.Query("filter_column"))
	query.FilterValue = strings.TrimSpace(c.Query("filter_value"))
	if len(query.Search) > 256 || len(query.FilterColumn) > 256 || len(query.FilterValue) > 512 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "preview search or filter is too long"})
		return
	}
	detail, err := h.gold.Artifact(
		c.Request.Context(),
		strings.TrimSpace(c.Param("snapshot_id")),
		strings.TrimSpace(c.Param("dataset")),
		sector,
		query,
	)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, detail)
}
