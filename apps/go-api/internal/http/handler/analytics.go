package handler

import (
	"go-api/internal/domain/entity"
	"go-api/internal/domain/service"
	"go-api/internal/http/dto"
	"go-api/internal/taxonomy"
	"net/http"
	"regexp"
	"strconv"

	"github.com/gin-gonic/gin"
)

var snapshotPattern = regexp.MustCompile(`^[A-Za-z0-9._-]{1,128}$`)

type AnalyticsHandler struct{ analytics service.Analytics }

func NewAnalyticsHandler(analytics service.Analytics) *AnalyticsHandler {
	return &AnalyticsHandler{analytics: analytics}
}

func (h *AnalyticsHandler) ListCandidates(c *gin.Context) {
	page := entity.PageRequest{Limit: dto.DefaultPageSize}
	if raw := c.Query("limit"); raw != "" {
		limit, err := strconv.Atoi(raw)
		if err != nil || limit < 1 || limit > dto.MaxPageSize {
			c.JSON(http.StatusBadRequest, gin.H{"error": taxonomy.ErrInvalidPage.Error()})
			return
		}
		page.Limit = limit
	}
	if raw := c.Query("offset"); raw != "" {
		offset, err := strconv.Atoi(raw)
		if err != nil || offset < 0 || offset > dto.MaxOffset {
			c.JSON(http.StatusBadRequest, gin.H{"error": taxonomy.ErrInvalidPage.Error()})
			return
		}
		page.Offset = offset
	}

	var sector int
	if raw := c.Query("sector"); raw != "" {
		s, err := strconv.Atoi(raw)
		if err != nil || s < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": taxonomy.ErrInvalidSector.Error()})
			return
		}
		sector = s
	}

	snapshot := c.Query("snapshot_id")
	if snapshot == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": taxonomy.ErrMissingSnapshot.Error()})
		return
	}
	if !snapshotPattern.MatchString(snapshot) {
		c.JSON(http.StatusBadRequest, gin.H{"error": taxonomy.ErrInvalidSnapshot.Error()})
		return
	}

	result, err := h.analytics.ListCandidates(c.Request.Context(), sector, snapshot, page)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "analytical data store is unavailable"})
		return
	}

	candidates := make([]gin.H, len(result.Items))
	for i, item := range result.Items {
		candidates[i] = gin.H{
			"prediction_id":         item.PredictionID,
			"source_product_id":    item.SourceProductID,
			"tic_id":                item.TICID,
			"sector":                item.Sector,
			"raw_logit":             item.RawLogit,
			"candidate_score":       item.CandidateScore,
			"decision_threshold":    item.Threshold,
			"above_threshold":       item.AboveThreshold,
			"model_version":         item.ModelVersion,
			"registered_model_id":   item.RegisteredModel,
			"gold_snapshot_id":      item.SnapshotID,
			"runtime_validation_id": item.ValidationID,
			"runtime_package_id":    item.RuntimePkgID,
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"task":        "candidate_vetting",
		"count":       result.Count,
		"candidates":  candidates,
		"page": gin.H{
			"count":    result.Count,
			"limit":    result.Limit,
			"offset":   result.Offset,
			"has_more": result.HasMore,
		},
		"snapshot_id": snapshot,
	})
}

func (h *AnalyticsHandler) ListAnomalies(c *gin.Context) {
	page := entity.PageRequest{Limit: dto.DefaultPageSize}
	if raw := c.Query("limit"); raw != "" {
		limit, err := strconv.Atoi(raw)
		if err != nil || limit < 1 || limit > dto.MaxPageSize {
			c.JSON(http.StatusBadRequest, gin.H{"error": taxonomy.ErrInvalidPage.Error()})
			return
		}
		page.Limit = limit
	}
	if raw := c.Query("offset"); raw != "" {
		offset, err := strconv.Atoi(raw)
		if err != nil || offset < 0 || offset > dto.MaxOffset {
			c.JSON(http.StatusBadRequest, gin.H{"error": taxonomy.ErrInvalidPage.Error()})
			return
		}
		page.Offset = offset
	}

	var sector int
	if raw := c.Query("sector"); raw != "" {
		s, err := strconv.Atoi(raw)
		if err != nil || s < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": taxonomy.ErrInvalidSector.Error()})
			return
		}
		sector = s
	}

	snapshot := c.Query("snapshot_id")
	if snapshot == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": taxonomy.ErrMissingSnapshot.Error()})
		return
	}
	if !snapshotPattern.MatchString(snapshot) {
		c.JSON(http.StatusBadRequest, gin.H{"error": taxonomy.ErrInvalidSnapshot.Error()})
		return
	}

	result, err := h.analytics.ListAnomalies(c.Request.Context(), sector, snapshot, page)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "analytical data store is unavailable"})
		return
	}

	anomalies := make([]gin.H, len(result.Items))
	for i, item := range result.Items {
		anomalies[i] = gin.H{
			"prediction_id":         item.PredictionID,
			"source_product_id":    item.SourceProductID,
			"tic_id":                item.TICID,
			"sector":                item.Sector,
			"reconstruction_mse":    item.ReconstructionMSE,
			"decision_threshold":    item.Threshold,
			"above_threshold":       item.AboveThreshold,
			"model_version":         item.ModelVersion,
			"registered_model_id":   item.RegisteredModel,
			"gold_snapshot_id":      item.SnapshotID,
			"runtime_validation_id": item.ValidationID,
			"runtime_package_id":    item.RuntimePkgID,
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"task":        "astronomical_anomaly_detection",
		"count":       result.Count,
		"anomalies":   anomalies,
		"page": gin.H{
			"count":    result.Count,
			"limit":    result.Limit,
			"offset":   result.Offset,
			"has_more": result.HasMore,
		},
		"snapshot_id": snapshot,
	})
}

func (h *AnalyticsHandler) ListTargets(c *gin.Context) {
	page := entity.PageRequest{Limit: dto.DefaultPageSize}
	if raw := c.Query("limit"); raw != "" {
		limit, err := strconv.Atoi(raw)
		if err != nil || limit < 1 || limit > dto.MaxPageSize {
			c.JSON(http.StatusBadRequest, gin.H{"error": taxonomy.ErrInvalidPage.Error()})
			return
		}
		page.Limit = limit
	}
	if raw := c.Query("offset"); raw != "" {
		offset, err := strconv.Atoi(raw)
		if err != nil || offset < 0 || offset > dto.MaxOffset {
			c.JSON(http.StatusBadRequest, gin.H{"error": taxonomy.ErrInvalidPage.Error()})
			return
		}
		page.Offset = offset
	}

	var sector int
	if raw := c.Query("sector"); raw != "" {
		s, err := strconv.Atoi(raw)
		if err != nil || s < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": taxonomy.ErrInvalidSector.Error()})
			return
		}
		sector = s
	}

	result, err := h.analytics.ListTargets(c.Request.Context(), sector, page)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "analytical data store is unavailable"})
		return
	}

	targets := make([]gin.H, len(result.Items))
	for i, item := range result.Items {
		targets[i] = gin.H{
			"tic_id":       item.TICID,
			"tess_mag":     item.TessMag,
			"ra":           item.RA,
			"dec":          item.Dec,
			"effective_t":  item.EffectiveT,
			"surface_grav": item.SurfaceGrav,
			"radius":       item.Radius,
			"sector":       item.Sector,
			"matched_toi":  item.TOI,
			"disposition":  item.Disposition,
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"count":   result.Count,
		"targets": targets,
		"page": gin.H{
			"count":    result.Count,
			"limit":    result.Limit,
			"offset":   result.Offset,
			"has_more": result.HasMore,
		},
	})
}

func (h *AnalyticsHandler) GetLightcurve(c *gin.Context) {
	page := entity.PageRequest{Limit: dto.DefaultPageSize}
	if raw := c.Query("limit"); raw != "" {
		limit, err := strconv.Atoi(raw)
		if err != nil || limit < 1 || limit > dto.MaxPageSize {
			c.JSON(http.StatusBadRequest, gin.H{"error": taxonomy.ErrInvalidPage.Error()})
			return
		}
		page.Limit = limit
	}
	if raw := c.Query("offset"); raw != "" {
		offset, err := strconv.Atoi(raw)
		if err != nil || offset < 0 || offset > dto.MaxOffset {
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

	result, err := h.analytics.GetLightcurve(c.Request.Context(), ticID, page)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "analytical data store is unavailable"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"tic_id": result.TICID,
		"time":   result.Time,
		"flux":   result.Flux,
		"page": gin.H{
			"limit":  page.Limit,
			"offset": page.Offset,
		},
	})
}
