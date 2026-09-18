package handler

import (
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"go-api/internal/domain/entity"
	"go-api/internal/domain/service"
	"go-api/internal/taxonomy"

	"github.com/gin-gonic/gin"
)

const (
	candidateDefaultPageSize = 100
	candidateMaxPageSize     = 1000
	candidateMaxOffset       = 10_000_000
)

var candidateSnapshotPattern = regexp.MustCompile(`^[A-Za-z0-9._-]{1,128}$`)

// CandidateHandler cung cấp các endpoint phục vụ quản lý và thẩm định ứng viên ngoại hành tinh
type CandidateHandler struct {
	candidate service.Candidate
}

// NewCandidateHandler khởi tạo CandidateHandler
func NewCandidateHandler(candidate service.Candidate) *CandidateHandler {
	return &CandidateHandler{candidate: candidate}
}

// ListCandidates phân trang danh sách các ứng viên ngoại hành tinh đã được mô hình ML
// (Candidate Vetting CNN) phân tích và dự đoán xác suất `candidate_score`.
func (h *CandidateHandler) ListCandidates(c *gin.Context) {
	page := entity.PageRequest{Limit: candidateDefaultPageSize}
	if raw := c.Query("limit"); raw != "" {
		limit, err := strconv.Atoi(raw)
		if err != nil || limit < 1 || limit > candidateMaxPageSize {
			c.JSON(http.StatusBadRequest, gin.H{"error": taxonomy.ErrInvalidPage.Error()})
			return
		}
		page.Limit = limit
	}
	if raw := c.Query("offset"); raw != "" {
		offset, err := strconv.Atoi(raw)
		if err != nil || offset < 0 || offset > candidateMaxOffset {
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
	if !candidateSnapshotPattern.MatchString(snapshot) {
		c.JSON(http.StatusBadRequest, gin.H{"error": taxonomy.ErrInvalidSnapshot.Error()})
		return
	}

	query := entity.CandidateQuery{
		Sector:     sector,
		SnapshotID: snapshot,
		Page:       page,
	}

	result, err := h.candidate.ListCandidates(c.Request.Context(), query)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "analytical data store is unavailable"})
		return
	}

	if result.Items == nil {
		result.Items = []entity.Candidate{}
	}

	c.JSON(http.StatusOK, entity.CandidateListResponse{
		Task:       "candidate_vetting",
		Count:      result.Count,
		Candidates: result.Items,
		Page:       result.Metadata(),
		SnapshotID: snapshot,
	})
}

// GetCandidate trả về toàn bộ thông tin về một ứng viên hành tinh, bao gồm:
// - Dự đoán ML (`candidate`)
// - Bằng chứng quan sát & trắc quang (`evidence`)
// - Các đặc tính vật lý thiên văn giải tích (`planet_physics`)
// - Đánh giá khả năng sống được (`habitability`)
func (h *CandidateHandler) GetCandidate(c *gin.Context) {
	predictionID := c.Param("prediction_id")
	if predictionID == "" || !candidateSnapshotPattern.MatchString(predictionID) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "prediction_id is invalid"})
		return
	}
	snapshot := c.Query("snapshot_id")
	if snapshot == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": taxonomy.ErrMissingSnapshot.Error()})
		return
	}
	if !candidateSnapshotPattern.MatchString(snapshot) {
		c.JSON(http.StatusBadRequest, gin.H{"error": taxonomy.ErrInvalidSnapshot.Error()})
		return
	}
	detail, err := h.candidate.GetCandidate(c.Request.Context(), predictionID, snapshot)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			c.JSON(http.StatusNotFound, gin.H{"error": taxonomy.ErrNotFound.Error()})
		} else {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": taxonomy.ErrAnalyticsUnavailable.Error()})
		}
		return
	}

	if detail.Physics.Warnings == nil {
		detail.Physics.Warnings = []string{}
	}
	if detail.Habitability.Components == nil {
		detail.Habitability.Components = []entity.HabitabilityComponent{}
	}
	detail.SnapshotID = snapshot

	c.JSON(http.StatusOK, detail)
}

// ReviewCandidate ghi nhận đánh giá thẩm định khoa học cho một ứng viên hành tinh
func (h *CandidateHandler) ReviewCandidate(c *gin.Context) {
	predictionID := strings.TrimSpace(c.Param("prediction_id"))
	if predictionID == "" || !candidateSnapshotPattern.MatchString(predictionID) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "prediction_id is invalid"})
		return
	}
	var request struct {
		SnapshotID string `json:"snapshot_id"`
		Decision   string `json:"decision"`
		Note       string `json:"note"`
	}
	if err := c.ShouldBindJSON(&request); err != nil || !candidateSnapshotPattern.MatchString(request.SnapshotID) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid candidate review payload"})
		return
	}
	decision := strings.ToUpper(strings.TrimSpace(request.Decision))
	if decision != "CONFIRMED" && decision != "REJECTED" && decision != "FOLLOW_UP" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "scientific decision must be CONFIRMED, REJECTED or FOLLOW_UP"})
		return
	}
	note := strings.TrimSpace(request.Note)
	if len(note) > 2000 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "review note must not exceed 2000 characters"})
		return
	}

	input := entity.CandidateReviewInput{
		PredictionID: predictionID,
		SnapshotID:   request.SnapshotID,
		Decision:     decision,
		Note:         note,
		Reviewer:     "HUMAN_OPERATOR",
	}

	review, err := h.candidate.ReviewCandidate(c.Request.Context(), input)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			c.JSON(http.StatusNotFound, gin.H{"error": taxonomy.ErrNotFound.Error()})
			return
		}
		if strings.Contains(err.Error(), "decision") || strings.Contains(err.Error(), "review note") {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "candidate review store is unavailable"})
		return
	}
	c.JSON(http.StatusOK, entity.CandidateReviewResponse{
		Status: "reviewed",
		Review: *review,
	})
}
