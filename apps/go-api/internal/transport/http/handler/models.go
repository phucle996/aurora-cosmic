package handler

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"go-api/internal/domain/entity"
	"go-api/internal/domain/repo"
	"go-api/internal/domain/service"
	"go-api/internal/taxonomy"
	"go-api/internal/transport/http/dto"

	"github.com/gin-gonic/gin"
)

type ModelsHandler struct {
	models    service.Models
	inference service.Inference
}

func (h *ModelsHandler) GetModelEvaluation(c *gin.Context) {
	evaluation, err := h.models.GetModelEvaluation(c.Request.Context(), strings.TrimSpace(c.Param("runtime_package_id")))
	if err != nil {
		if errors.Is(err, repo.ErrObjectNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "model evaluation evidence was not found"})
			return
		}
		if errors.Is(err, taxonomy.ErrInvalidRequest) {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "model evaluation storage is unavailable"})
		return
	}
	c.JSON(http.StatusOK, evaluation)
}

func NewModelsHandler(models service.Models, inference service.Inference) *ModelsHandler {
	return &ModelsHandler{models: models, inference: inference}
}

func (h *ModelsHandler) ListModels(c *gin.Context) {
	models, err := h.models.ListModels(c.Request.Context(), strings.TrimSpace(c.Query("task")))
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "model storage is unavailable"})
		return
	}
	items := make([]gin.H, len(models))
	for i, m := range models {
		items[i] = gin.H{
			"model_id":              m.ModelID,
			"runtime_package_id":    m.RuntimePackageID,
			"task":                  m.Task,
			"model_version":         m.ModelVersion,
			"status":                m.Status,
			"runtime_manifest_key":  m.RuntimeManifestKey,
			"preprocessing_version": m.PreprocessingVersion,
			"feature_count":         m.FeatureCount,
			"feature_order":         m.FeatureOrder,
			"onnx_size_bytes":       m.ONNXSizeBytes,
			"onnx_sha256":           m.ONNXSHA256,
			"decision_threshold":    m.DecisionThreshold,
			"parity_status":         m.ParityStatus,
			"integrity_status":      m.IntegrityStatus,
			"evaluation_run_id":     m.EvaluationRunID,
			"created_at":            m.CreatedAt,
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"models": items,
		"count":  len(items),
		"source": "minio-runtime-registry",
	})
}

func (h *ModelsHandler) TrainingReadiness(c *gin.Context) {
	snapshotIDs := c.QueryArray("snapshot_id")
	if len(snapshotIDs) == 0 {
		snapshotIDs = strings.Split(c.Query("snapshot_ids"), ",")
	}
	readiness, err := h.models.TrainingReadiness(c.Request.Context(), snapshotIDs)
	if err != nil {
		if errors.Is(err, taxonomy.ErrInvalidRequest) {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		} else {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		}
		return
	}
	c.JSON(http.StatusOK, readiness)
}

func (h *ModelsHandler) OverrideTrainingLabel(c *gin.Context) {
	var request struct {
		SnapshotID      string  `json:"snapshot_id"`
		SourceProductID string  `json:"source_product_id"`
		TrainingLabel   string  `json:"training_label"`
		ReviewReason    string  `json:"review_reason"`
		Confidence      float64 `json:"confidence"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid label review payload"})
		return
	}
	err := h.models.OverrideTrainingLabel(c.Request.Context(), entity.TrainingLabelOverride{
		SnapshotID: request.SnapshotID, SourceProductID: request.SourceProductID,
		TrainingLabel: request.TrainingLabel, ReviewReason: request.ReviewReason,
		Confidence: request.Confidence,
	})
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "reviewed"})
}

func (h *ModelsHandler) ListTrainingReviews(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
	reviews, err := h.models.ListTrainingReviews(c.Request.Context(), limit)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": reviews, "count": len(reviews)})
}

func (h *ModelsHandler) ListTrainingReviewQueue(c *gin.Context) {
	snapshotIDs := c.QueryArray("snapshot_id")
	if len(snapshotIDs) == 0 {
		snapshotIDs = strings.Split(c.Query("snapshot_ids"), ",")
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	page, err := h.models.ListTrainingReviewQueue(c.Request.Context(), snapshotIDs, entity.PageRequest{Limit: limit, Offset: offset})
	if err != nil {
		if errors.Is(err, taxonomy.ErrInvalidRequest) {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		} else {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		}
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"items": page.Items, "count": page.Count, "limit": page.Limit,
		"offset": page.Offset, "has_more": page.HasMore,
	})
}

func (h *ModelsHandler) ListInferenceJobs(c *gin.Context) {
	jobs, err := h.inference.ListJobs(c.Request.Context(), strings.TrimSpace(c.Query("task")), strings.TrimSpace(c.Query("model_id")))
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "model storage is unavailable"})
		return
	}
	items := make([]gin.H, len(jobs))
	for i, j := range jobs {
		items[i] = gin.H{
			"job_id":                    j.JobID,
			"task":                      j.Task,
			"model_id":                  j.ModelID,
			"model_version":             j.ModelVersion,
			"runtime_package_id":        j.RuntimePackageID,
			"gold_snapshot_id":          j.GoldSnapshotID,
			"gold_artifact_key":         j.GoldArtifactKey,
			"sector":                    j.Sector,
			"expected_prediction_count": j.ExpectedPredictionCount,
			"created_at":                j.CreatedAt,
			"status":                    j.Status,
			"output_key":                j.OutputKey,
			"output_sha256":             j.OutputSHA256,
			"processed_rows":            j.ProcessedRows,
			"attempt":                   j.Attempt,
			"started_at":                j.StartedAt,
			"updated_at":                j.UpdatedAt,
			"error":                     j.Error,
			"producer":                  j.Producer,
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"jobs":  items,
		"count": len(items),
	})
}

func (h *ModelsHandler) RetryInferenceJob(c *gin.Context) {
	jobID := strings.TrimSpace(c.Param("job_id"))
	if jobID == "" || strings.Contains(jobID, "/") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "job_id is required"})
		return
	}
	manifest, event, err := h.inference.RetryJob(c.Request.Context(), jobID)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "failed to queue inference job"})
		return
	}
	c.JSON(http.StatusAccepted, gin.H{
		"job_id": manifest.JobID,
		"status": "queued",
		"event":  event,
	})
}

// StartTraining tiếp nhận request huấn luyện mô hình mới và dispatch tới GPU worker
func (h *ModelsHandler) StartTraining(c *gin.Context) {
	var req dto.TrainingJobRequest
	if err := c.ShouldBindJSON(&req); err != nil && c.Request.ContentLength > 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid training payload"})
		return
	}

	spec := entity.TrainingJobSpec{
		Task:            req.Task,
		GoldSnapshotID:  req.GoldSnapshotID,
		GoldSnapshotIDs: req.GoldSnapshotIDs,
		BaseModelID:     req.BaseModelID,
		TrainingMode:    req.TrainingMode,
		Epochs:          req.Epochs,
		LearningRate:    req.LearningRate,
		BatchSize:       req.BatchSize,
		Seed:            req.Seed,
		AutoPromote:     req.AutoPromote,
		ComputeTarget:   req.ComputeTarget,
	}

	result, err := h.models.StartTrainingJob(c.Request.Context(), spec)
	if err != nil {
		if errors.Is(err, taxonomy.ErrInvalidRequest) {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		} else {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		}
		return
	}

	c.JSON(http.StatusAccepted, dto.TrainingJobResponse{
		JobID:           result.JobID,
		Task:            result.Task,
		GoldSnapshotID:  result.GoldSnapshotID,
		GoldSnapshotIDs: result.GoldSnapshotIDs,
		Status:          result.Status,
		CreatedAt:       result.CreatedAt,
		Message:         result.Message,
		ComputeTarget:   result.ComputeTarget,
	})
}

// DeployModel chuyển đổi mô hình phục vụ suy luận Champion hoặc hủy kích hoạt
func (h *ModelsHandler) DeployModel(c *gin.Context) {
	var req dto.ModelDeployRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid deploy payload"})
		return
	}
	if req.Active && strings.TrimSpace(req.ModelID) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "model_id is required when active is true"})
		return
	}
	result, err := h.models.SetModelDeployment(c.Request.Context(), strings.TrimSpace(req.ModelID), strings.TrimSpace(req.Task), req.Active, strings.TrimSpace(req.TicketID))
	if err != nil {
		if errors.Is(err, taxonomy.ErrInvalidRequest) {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		} else {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		}
		return
	}
	statusMsg := "Model " + req.ModelID + " is now deployed as Champion for live inference."
	if !req.Active {
		statusMsg = "Inference deployment deactivated for task " + req.Task + "."
	}
	c.JSON(http.StatusOK, dto.ModelDeployResponse{
		Status:              "success",
		ModelID:             req.ModelID,
		Task:                req.Task,
		Active:              req.Active,
		Message:             statusMsg,
		TicketID:            result.TicketID,
		RuntimeValidationID: result.RuntimeValidation,
		Engine:              result.Engine,
		MaxAbsoluteError:    result.MaxAbsoluteError,
		MaxRelativeError:    result.MaxRelativeError,
	})
}
