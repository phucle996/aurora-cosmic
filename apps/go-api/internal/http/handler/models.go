package handler

import (
	"net/http"
	"strings"

	"go-api/internal/domain/entity"
	"go-api/internal/domain/service"

	"github.com/gin-gonic/gin"
)

type ModelsHandler struct {
	models    service.Models
	inference service.Inference
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
	var req entity.TrainingJobRequest
	if err := c.ShouldBindJSON(&req); err != nil && c.Request.ContentLength > 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid training payload"})
		return
	}

	result, err := h.models.StartTrainingJob(c.Request.Context(), req)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusAccepted, gin.H{
		"job_id":           result.JobID,
		"task":             result.Task,
		"gold_snapshot_id": result.GoldSnapshotID,
		"status":           result.Status,
		"created_at":       result.CreatedAt,
		"message":          result.Message,
	})
}
