package handler

import (
	"errors"
	"net/http"
	"regexp"
	"strconv"

	"go-api/internal/domain/entity"
	"go-api/internal/domain/repo"
	"go-api/internal/domain/service"
	"go-api/internal/taxonomy"

	"github.com/gin-gonic/gin"
)

const (
	anomalyDefaultPageSize = 100
	anomalyMaxPageSize     = 1000
	anomalyMaxOffset       = 10_000_000
)

var anomalySnapshotPattern = regexp.MustCompile(`^[A-Za-z0-9._-]{1,128}$`)

// AnomalyHandler cung cấp các endpoint phục vụ truy vấn và giải thích dị thường trắc quang
type AnomalyHandler struct {
	anomaly service.Anomaly
}

// NewAnomalyHandler khởi tạo AnomalyHandler
func NewAnomalyHandler(anomaly service.Anomaly) *AnomalyHandler {
	return &AnomalyHandler{anomaly: anomaly}
}

// ListAnomalies phân trang danh sách các dị thường trắc quang được phát hiện
// bởi mô hình Autoencoder (Reconstruction MSE vượt ngưỡng threshold).
func (h *AnomalyHandler) ListAnomalies(c *gin.Context) {
	page := entity.PageRequest{Limit: anomalyDefaultPageSize}
	if raw := c.Query("limit"); raw != "" {
		limit, err := strconv.Atoi(raw)
		if err != nil || limit < 1 || limit > anomalyMaxPageSize {
			c.JSON(http.StatusBadRequest, gin.H{"error": taxonomy.ErrInvalidPage.Error()})
			return
		}
		page.Limit = limit
	}
	if raw := c.Query("offset"); raw != "" {
		offset, err := strconv.Atoi(raw)
		if err != nil || offset < 0 || offset > anomalyMaxOffset {
			c.JSON(http.StatusBadRequest, gin.H{"error": taxonomy.ErrInvalidPage.Error()})
			return
		}
		page.Offset = offset
	}

	var sector int
	if raw := c.Query("sector"); raw != "" {
		s, parseErr := strconv.Atoi(raw)
		if parseErr != nil || s < 1 {
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
	if !anomalySnapshotPattern.MatchString(snapshot) {
		c.JSON(http.StatusBadRequest, gin.H{"error": taxonomy.ErrInvalidSnapshot.Error()})
		return
	}
	flaggedOnly := true
	if raw := c.Query("only_flagged"); raw != "" {
		parsed, err := strconv.ParseBool(raw)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "only_flagged must be a boolean"})
			return
		}
		flaggedOnly = parsed
	}

	result, err := h.anomaly.ListAnomalies(c.Request.Context(), sector, snapshot, flaggedOnly, page)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "analytical data store is unavailable"})
		return
	}

	if result.Items == nil {
		result.Items = []entity.Anomaly{}
	}

	c.JSON(http.StatusOK, entity.AnomalyListResponse{
		Task:        "astronomical_anomaly_detection",
		Count:       result.Count,
		Anomalies:   result.Items,
		Page:        result.Metadata(),
		SnapshotID:  snapshot,
		OnlyFlagged: flaggedOnly,
	})
}

// GetAnomalyDetail trả về sidecar giải thích mô hình cho một dự đoán dị thường
func (h *AnomalyHandler) GetAnomalyDetail(c *gin.Context) {
	predictionID := c.Param("prediction_id")
	if !anomalySnapshotPattern.MatchString(predictionID) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid prediction_id"})
		return
	}
	snapshot := c.Query("snapshot_id")
	if snapshot == "" || !anomalySnapshotPattern.MatchString(snapshot) {
		c.JSON(http.StatusBadRequest, gin.H{"error": taxonomy.ErrInvalidSnapshot.Error()})
		return
	}
	detail, err := h.anomaly.GetAnomalyDetail(c.Request.Context(), predictionID, snapshot)
	if err != nil {
		if errors.Is(err, repo.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": taxonomy.ErrNotFound.Error()})
			return
		}
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "anomaly detail is unavailable"})
		return
	}
	detail.SnapshotID = snapshot
	c.JSON(http.StatusOK, detail)
}
