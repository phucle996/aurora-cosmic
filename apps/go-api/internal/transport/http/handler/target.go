package handler

import (
	"math"
	"net/http"
	"strconv"
	"strings"

	"go-api/internal/domain/entity"
	"go-api/internal/domain/service"
	"go-api/internal/taxonomy"

	"github.com/gin-gonic/gin"
)

const (
	targetDefaultPageSize       = 100
	targetMaxPageSize           = 1000
	targetMaxLightcurvePageSize = 50_000
	targetMaxOffset             = 10_000_000
)

// TargetHandler cung cấp các endpoint phục vụ tìm kiếm TIC targets và trắc quang đường cong ánh sáng
type TargetHandler struct {
	target service.Target
}

// NewTargetHandler khởi tạo TargetHandler
func NewTargetHandler(target service.Target) *TargetHandler {
	return &TargetHandler{target: target}
}

// ListTargets lọc và phân trang danh sách các ngôi sao mục tiêu trong TESS Input Catalog (TIC),
// hỗ trợ các bộ lọc tọa độ RA/Dec, cấp sao TMag, nhiệt độ Teff, và trạng thái pipeline.
func (h *TargetHandler) ListTargets(c *gin.Context) {
	page := entity.PageRequest{Limit: targetDefaultPageSize}
	if raw := c.Query("limit"); raw != "" {
		limit, err := strconv.Atoi(raw)
		if err != nil || limit < 1 || limit > targetMaxPageSize {
			c.JSON(http.StatusBadRequest, gin.H{"error": taxonomy.ErrInvalidPage.Error()})
			return
		}
		page.Limit = limit
	}
	if raw := c.Query("offset"); raw != "" {
		offset, err := strconv.Atoi(raw)
		if err != nil || offset < 0 || offset > targetMaxOffset {
			c.JSON(http.StatusBadRequest, gin.H{"error": taxonomy.ErrInvalidPage.Error()})
			return
		}
		page.Offset = offset
	}

	query := entity.TargetQuery{Page: page, SnapshotID: strings.TrimSpace(c.Query("snapshot_id"))}
	if query.SnapshotID != "" && (strings.Contains(query.SnapshotID, "/") || !strings.HasPrefix(query.SnapshotID, "gold-v1-")) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "snapshot_id must be a valid Gold snapshot id"})
		return
	}
	if raw := c.Query("tic_id"); raw != "" {
		ticID, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || ticID < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "tic_id must be a positive integer"})
			return
		}
		query.TICID = ticID
	}
	if raw := c.Query("sector"); raw != "" {
		sector, err := strconv.Atoi(raw)
		if err != nil || sector < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": taxonomy.ErrInvalidSector.Error()})
			return
		}
		query.Sector = sector
	}
	parseFloat := func(name string, target **float64) bool {
		raw := c.Query(name)
		if raw == "" {
			return true
		}
		value, err := strconv.ParseFloat(raw, 64)
		if err != nil || math.IsNaN(value) || math.IsInf(value, 0) {
			return false
		}
		*target = &value
		return true
	}
	if !parseFloat("tmag_min", &query.TessMagMin) || !parseFloat("tmag_max", &query.TessMagMax) ||
		!parseFloat("teff_min", &query.EffectiveTMin) || !parseFloat("teff_max", &query.EffectiveTMax) ||
		!parseFloat("ra_min", &query.RAMin) || !parseFloat("ra_max", &query.RAMax) ||
		!parseFloat("dec_min", &query.DecMin) || !parseFloat("dec_max", &query.DecMax) {
		c.JSON(http.StatusBadRequest, gin.H{"error": taxonomy.ErrInvalidTargetFilter.Error()})
		return
	}
	if query.TessMagMin != nil && query.TessMagMax != nil && *query.TessMagMin > *query.TessMagMax {
		c.JSON(http.StatusBadRequest, gin.H{"error": "tmag_min must not exceed tmag_max"})
		return
	}
	if query.EffectiveTMin != nil && query.EffectiveTMax != nil && *query.EffectiveTMin > *query.EffectiveTMax {
		c.JSON(http.StatusBadRequest, gin.H{"error": "teff_min must not exceed teff_max"})
		return
	}
	if query.RAMin != nil && (*query.RAMin < 0 || *query.RAMin > 360) || query.RAMax != nil && (*query.RAMax < 0 || *query.RAMax > 360) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "RA must be between 0 and 360 degrees"})
		return
	}
	if query.DecMin != nil && (*query.DecMin < -90 || *query.DecMin > 90) || query.DecMax != nil && (*query.DecMax < -90 || *query.DecMax > 90) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Dec must be between -90 and 90 degrees"})
		return
	}
	if query.RAMin != nil && query.RAMax != nil && *query.RAMin > *query.RAMax {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ra_min must not exceed ra_max"})
		return
	}
	if query.DecMin != nil && query.DecMax != nil && *query.DecMin > *query.DecMax {
		c.JSON(http.StatusBadRequest, gin.H{"error": "dec_min must not exceed dec_max"})
		return
	}
	if status := c.Query("pipeline_status"); status != "" {
		if status != "discovered" && status != "ingested" && status != "scored" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "pipeline_status must be discovered, ingested, or scored"})
			return
		}
		query.PipelineStatus = status
	}
	parseBoolFilter := func(name string, target **bool) bool {
		raw := c.Query(name)
		if raw == "" {
			return true
		}
		value, err := strconv.ParseBool(raw)
		if err != nil {
			return false
		}
		*target = &value
		return true
	}
	if !parseBoolFilter("has_lightcurve", &query.HasLightcurve) || !parseBoolFilter("has_candidate", &query.HasCandidate) || !parseBoolFilter("has_anomaly", &query.HasAnomaly) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "has_lightcurve, has_candidate, and has_anomaly must be boolean"})
		return
	}
	query.Sort = c.Query("sort")
	if query.Sort != "" && query.Sort != "tmag_asc" && query.Sort != "tmag_desc" && query.Sort != "teff_asc" && query.Sort != "teff_desc" && query.Sort != "candidate_desc" && query.Sort != "anomaly_desc" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported target sort"})
		return
	}

	result, err := h.target.ListTargets(c.Request.Context(), query)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "analytical data store is unavailable"})
		return
	}

	if result.Items == nil {
		result.Items = []entity.Target{}
	}

	c.JSON(http.StatusOK, entity.TargetListResponse{
		Count:   result.Count,
		Targets: result.Items,
		Page:    result.Metadata(),
	})
}

// GetTarget xem chi tiết một ngôi sao mục tiêu TIC
func (h *TargetHandler) GetTarget(c *gin.Context) {
	ticID, err := strconv.ParseInt(c.Param("tic_id"), 10, 64)
	if err != nil || ticID < 1 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "tic_id must be a positive integer"})
		return
	}
	sector := 0
	if raw := c.Query("sector"); raw != "" {
		sector, err = strconv.Atoi(raw)
		if err != nil || sector < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": taxonomy.ErrInvalidSector.Error()})
			return
		}
	}
	snapshotID := strings.TrimSpace(c.Query("snapshot_id"))
	if snapshotID != "" && (strings.Contains(snapshotID, "/") || !strings.HasPrefix(snapshotID, "gold-v1-")) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "snapshot_id must be a valid Gold snapshot id"})
		return
	}
	target, err := h.target.GetTarget(c.Request.Context(), ticID, sector, snapshotID)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			c.JSON(http.StatusNotFound, gin.H{"error": taxonomy.ErrNotFound.Error()})
		} else {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": taxonomy.ErrAnalyticsUnavailable.Error()})
		}
		return
	}
	resp := gin.H{
		"target": target.Target,
	}
	if target.Physics != nil {
		if target.Physics.Warnings == nil {
			target.Physics.Warnings = []string{}
		}
		resp["planet_physics"] = target.Physics
	}
	if target.Habitability != nil {
		if target.Habitability.Components == nil {
			target.Habitability.Components = []entity.HabitabilityComponent{}
		}
		resp["habitability"] = target.Habitability
	}
	if target.Evidence != nil {
		resp["evidence"] = target.Evidence
	}
	c.JSON(http.StatusOK, resp)
}

// GetLightcurve phân trang chuỗi dữ liệu đường cong ánh sáng (Flux time-series) của một ngôi sao
func (h *TargetHandler) GetLightcurve(c *gin.Context) {
	page := entity.PageRequest{Limit: targetDefaultPageSize}
	if raw := c.Query("limit"); raw != "" {
		limit, err := strconv.Atoi(raw)
		if err != nil || limit < 1 || limit > targetMaxLightcurvePageSize {
			c.JSON(http.StatusBadRequest, gin.H{"error": taxonomy.ErrInvalidPage.Error()})
			return
		}
		page.Limit = limit
	}
	if raw := c.Query("offset"); raw != "" {
		offset, err := strconv.Atoi(raw)
		if err != nil || offset < 0 || offset > targetMaxOffset {
			c.JSON(http.StatusBadRequest, gin.H{"error": taxonomy.ErrInvalidPage.Error()})
			return
		}
		page.Offset = offset
	}

	raw := c.Query("tic_id")
	if raw == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "tic_id is required"})
		return
	}
	ticID, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || ticID < 1 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "tic_id must be a positive integer"})
		return
	}
	sector := 0
	if raw := c.Query("sector"); raw != "" {
		parsed, parseErr := strconv.Atoi(raw)
		if parseErr != nil || parsed < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": taxonomy.ErrInvalidSector.Error()})
			return
		}
		sector = parsed
	}

	result, err := h.target.GetLightcurve(c.Request.Context(), ticID, sector, page)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "analytical data store is unavailable"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"tic_id": result.TICID,
		"sector": result.Sector,
		"time":   result.Time,
		"flux":   result.Flux,
		"page": gin.H{
			"limit":  page.Limit,
			"offset": page.Offset,
		},
	})
}
