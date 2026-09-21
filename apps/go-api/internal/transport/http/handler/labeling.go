package handler

import (
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"go-api/internal/domain/entity"
	"go-api/internal/domain/service"

	"github.com/gin-gonic/gin"
)

type LabelingHandler struct {
	labeling service.Labeling
}

func NewLabelingHandler(labeling service.Labeling) *LabelingHandler {
	return &LabelingHandler{labeling: labeling}
}

// GetCohortWorkspace xử lý Workflow 1: Lấy đồng thời Cohort Disposition và Target Queue Summary.
func (h *LabelingHandler) GetCohortWorkspace(c *gin.Context) {
	rawSnapshotIDs := c.QueryArray("snapshot_id")
	unique := make(map[string]struct{})
	for _, id := range rawSnapshotIDs {
		trimmed := strings.TrimSpace(id)
		if trimmed == "" {
			continue
		}
		if !strings.HasPrefix(trimmed, "gold-v1-") || strings.Contains(trimmed, "/") {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("invalid gold_snapshot_id %q: must start with 'gold-v1-' and contain no slashes", trimmed)})
			return
		}
		unique[trimmed] = struct{}{}
	}

	if len(unique) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "at least one gold_snapshot_id is required"})
		return
	}

	snapshotIDs := make([]string, 0, len(unique))
	for id := range unique {
		snapshotIDs = append(snapshotIDs, id)
	}
	sort.Strings(snapshotIDs)

	offsetStr := c.DefaultQuery("offset", "0")
	offset, err := strconv.Atoi(offsetStr)
	if err != nil || offset < 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "queue offset must be a non-negative integer"})
		return
	}

	limitStr := c.DefaultQuery("limit", "20")
	limit, err := strconv.Atoi(limitStr)
	if err != nil || limit <= 0 {
		limit = 20
	} else if limit > 100 {
		limit = 100
	}

	workspace, err := h.labeling.GetCohortWorkspace(c.Request.Context(), snapshotIDs, entity.PageRequest{
		Limit:  limit,
		Offset: offset,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, workspace)
}

// ListSnapshots xử lý luồng lấy danh sách Gold snapshot đã sẵn sàng cho Labeling Studio ("Select visible").
func (h *LabelingHandler) ListSnapshots(c *gin.Context) {
	limitStr := c.DefaultQuery("limit", "100")
	limit, err := strconv.Atoi(limitStr)
	if err != nil || limit <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "limit must be a positive integer"})
		return
	}
	if limit > 200 {
		limit = 200
	}

	snapshots, err := h.labeling.ListSnapshots(c.Request.Context(), limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"snapshots": snapshots})
}

// GetTargetEvidence xử lý luồng xem chi tiết bằng chứng khoa học và gợi ý model của 1 target cụ thể (dưới-phải).
func (h *LabelingHandler) GetTargetEvidence(c *gin.Context) {
	snapshotID := strings.TrimSpace(c.Query("snapshot_id"))
	if snapshotID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "snapshot_id is required"})
		return
	}
	if !strings.HasPrefix(snapshotID, "gold-v1-") || strings.Contains(snapshotID, "/") {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("invalid gold_snapshot_id %q: must start with 'gold-v1-' and contain no slashes", snapshotID)})
		return
	}

	sourceProductID := strings.TrimSpace(c.Query("source_product_id"))
	if sourceProductID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "source_product_id is required"})
		return
	}

	detail, err := h.labeling.GetTargetEvidence(c.Request.Context(), snapshotID, sourceProductID)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, detail)
}
