package handler

import (
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"go-api/internal/domain/entity"
	"go-api/internal/domain/service"
	"go-api/internal/provider"
	"go-api/internal/taxonomy"

	"github.com/gin-gonic/gin"
)

const maxSnapshotsPerPreflight = 200

var ticketIDPattern = regexp.MustCompile(`^[a-zA-Z0-9_\-]+$`)

// ModelHandler handles HTTP transport for Model domain workflows.
type ModelHandler struct {
	model service.Model
}

// NewModelHandler initializes a new ModelHandler instance.
func NewModelHandler(model service.Model) *ModelHandler {
	return &ModelHandler{model: model}
}

// TrainingPreflight validates request input and handles GET requests to evaluate preflight conditions.
func (h *ModelHandler) TrainingPreflight(c *gin.Context) {
	rawIDs := c.QueryArray("snapshot_id")
	if len(rawIDs) == 0 {
		raw := c.Query("snapshot_ids")
		if raw == "" {
			raw = c.Query("snapshot_id")
		}
		if raw != "" {
			rawIDs = strings.Split(raw, ",")
		}
	}

	// 1. Deduplicate, trim and validate count
	unique := make(map[string]struct{}, len(rawIDs))
	for _, raw := range rawIDs {
		trimmed := strings.TrimSpace(raw)
		if trimmed != "" {
			unique[trimmed] = struct{}{}
		}
	}

	if len(unique) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "at least one committed Gold snapshot is required"})
		return
	}

	if len(unique) > maxSnapshotsPerPreflight {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("at most %d Gold snapshots may be selected for training preflight", maxSnapshotsPerPreflight)})
		return
	}

	// 2. Validate format of each snapshot ID
	snapshotIDs := make([]string, 0, len(unique))
	for id := range unique {
		if !strings.HasPrefix(id, "gold-v1-") || strings.Contains(id, "/") {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("invalid gold_snapshot_id %q: must start with 'gold-v1-' and contain no slashes", id)})
			return
		}
		snapshotIDs = append(snapshotIDs, id)
	}
	sort.Strings(snapshotIDs)

	// 3. Delegate to service
	preflight, err := h.model.TrainingPreflight(c.Request.Context(), snapshotIDs)
	if err != nil {
		if errors.Is(err, taxonomy.ErrInvalidRequest) {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		} else {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		}
		return
	}

	c.JSON(http.StatusOK, preflight)
}

// ListSnapshots handles GET requests to retrieve committed Gold snapshots available for candidate model training.
func (h *ModelHandler) ListSnapshots(c *gin.Context) {
	limit := 100
	if rawLimit := strings.TrimSpace(c.Query("limit")); rawLimit != "" {
		if parsed, err := strconv.Atoi(rawLimit); err == nil {
			if parsed <= 0 || parsed > 200 {
				c.JSON(http.StatusBadRequest, gin.H{"error": "limit must be between 1 and 200"})
				return
			}
			limit = parsed
		} else {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid limit parameter"})
			return
		}
	}

	snapshots, err := h.model.ListTrainingSnapshots(c.Request.Context(), limit)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"snapshots": snapshots,
		"total":     len(snapshots),
	})
}

type startTrainingRequest struct {
	TicketID      string   `json:"ticket_id"`
	Task          string   `json:"task"`
	SnapshotIDs   []string `json:"gold_snapshot_ids"`
	SnapshotID    string   `json:"gold_snapshot_id"`
	TrainingMode  string   `json:"training_mode"`
	BaseModelID   string   `json:"base_model_id"`
	ComputeTarget string   `json:"compute_target"`
	Epochs        int      `json:"epochs"`
	BatchSize     int      `json:"batch_size"`
	LearningRate  float64  `json:"learning_rate"`
	Seed          int      `json:"seed"`
}

// StartTraining validates JSON parameters and dispatches a model training run.
func (h *ModelHandler) StartTraining(c *gin.Context) {
	var req startTrainingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("invalid JSON payload: %s", err.Error())})
		return
	}

	// 1. Snapshot IDs extraction and validation
	rawIDs := req.SnapshotIDs
	if req.SnapshotID != "" {
		rawIDs = append(rawIDs, req.SnapshotID)
	}

	unique := make(map[string]struct{}, len(rawIDs))
	for _, raw := range rawIDs {
		trimmed := strings.TrimSpace(raw)
		if trimmed != "" {
			unique[trimmed] = struct{}{}
		}
	}

	if len(unique) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "at least one committed Gold snapshot is required"})
		return
	}

	if len(unique) > maxSnapshotsPerPreflight {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("at most %d Gold snapshots may be selected for training", maxSnapshotsPerPreflight)})
		return
	}

	snapshotIDs := make([]string, 0, len(unique))
	for id := range unique {
		if !strings.HasPrefix(id, "gold-v1-") || strings.Contains(id, "/") {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("invalid gold_snapshot_id %q: must start with 'gold-v1-' and contain no slashes", id)})
			return
		}
		snapshotIDs = append(snapshotIDs, id)
	}
	sort.Strings(snapshotIDs)

	// 2. Training Mode validation
	req.TrainingMode = strings.TrimSpace(req.TrainingMode)
	if req.TrainingMode == "" {
		req.TrainingMode = "fine_tune"
	}
	if req.TrainingMode != "fine_tune" && req.TrainingMode != "scratch" {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("invalid training_mode %q: expected 'fine_tune' or 'scratch'", req.TrainingMode)})
		return
	}

	// 3. Base Model ID handling
	req.BaseModelID = strings.TrimSpace(req.BaseModelID)
	if req.TrainingMode == "scratch" {
		req.BaseModelID = ""
	} else if req.BaseModelID == "" {
		req.BaseModelID = "champion"
	}

	// 4. Compute Target validation
	req.ComputeTarget = strings.ToLower(strings.TrimSpace(req.ComputeTarget))
	if req.ComputeTarget == "" {
		req.ComputeTarget = "gpu"
	}
	if req.ComputeTarget != "cpu" && req.ComputeTarget != "gpu" {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("invalid compute_target %q: expected 'cpu' or 'gpu'", req.ComputeTarget)})
		return
	}

	// 5. Hyperparameters validation
	if req.Epochs == 0 {
		req.Epochs = 50
	} else if req.Epochs < 1 || req.Epochs > 500 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "epochs must be between 1 and 500"})
		return
	}

	if req.BatchSize == 0 {
		req.BatchSize = 32
	} else if req.BatchSize < 1 || req.BatchSize > 2048 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "batch_size must be between 1 and 2048"})
		return
	}

	if req.LearningRate == 0 {
		req.LearningRate = 0.001
	} else if req.LearningRate <= 0 || req.LearningRate > 1.0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "learning_rate must be greater than 0 and less than or equal to 1.0"})
		return
	}

	if req.Seed == 0 {
		req.Seed = 42
	} else if req.Seed < 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "seed must be greater than or equal to 0"})
		return
	}

	// 6. Task validation
	req.Task = strings.TrimSpace(req.Task)
	if req.Task == "" {
		req.Task = "candidate_vetting"
	}
	if req.Task != "candidate_vetting" {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("unsupported task %q: expected 'candidate_vetting'", req.Task)})
		return
	}

	// 7. Ticket ID generation and validation
	req.TicketID = strings.TrimSpace(req.TicketID)
	if req.TicketID == "" {
		req.TicketID = fmt.Sprintf("RUN-%s-%04d", time.Now().UTC().Format("20060102"), time.Now().UnixNano()%10000)
	} else if len(req.TicketID) > 128 || !ticketIDPattern.MatchString(req.TicketID) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid ticket_id format: expected alphanumeric, hyphen or underscore up to 128 chars"})
		return
	}

	spec := entity.StartTrainingSpec{
		TicketID:      req.TicketID,
		Task:          req.Task,
		SnapshotIDs:   snapshotIDs,
		TrainingMode:  req.TrainingMode,
		BaseModelID:   req.BaseModelID,
		ComputeTarget: req.ComputeTarget,
		Epochs:        req.Epochs,
		BatchSize:     req.BatchSize,
		LearningRate:  req.LearningRate,
		Seed:          req.Seed,
	}

	result, err := h.model.StartTraining(c.Request.Context(), spec)
	if err != nil {
		if errors.Is(err, taxonomy.ErrInvalidRequest) {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		} else {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		}
		return
	}

	c.JSON(http.StatusOK, result)
}

// ControlTraining handles intervention signals (cancel or checkpoint) for active training runs.
func (h *ModelHandler) ControlTraining(c *gin.Context) {
	var req entity.TrainingControlSpec
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "malformed JSON: expected ticket_id and action"})
		return
	}

	req.TicketID = strings.TrimSpace(req.TicketID)
	if req.TicketID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ticket_id is required"})
		return
	}
	if !ticketIDPattern.MatchString(req.TicketID) || len(req.TicketID) > 128 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid ticket_id format: expected alphanumeric, hyphen or underscore up to 128 chars"})
		return
	}

	req.Action = strings.TrimSpace(strings.ToLower(req.Action))
	if req.Action != "cancel" && req.Action != "checkpoint" {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("invalid action %q: expected 'cancel' or 'checkpoint'", req.Action)})
		return
	}

	result, err := h.model.ControlTraining(c.Request.Context(), req)
	if err != nil {
		if errors.Is(err, taxonomy.ErrInvalidRequest) {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		} else {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		}
		return
	}

	c.JSON(http.StatusOK, result)
}

// GetActiveTraining retrieves the current soft state (progress, metrics, logs) for an active training run.
func (h *ModelHandler) GetActiveTraining(c *gin.Context) {
	ticketID := strings.TrimSpace(c.Query("ticket_id"))
	if ticketID != "" && (!ticketIDPattern.MatchString(ticketID) || len(ticketID) > 128) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid ticket_id format"})
		return
	}

	state, err := h.model.GetActiveTraining(c.Request.Context(), ticketID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if state == nil {
		c.JSON(http.StatusOK, gin.H{
			"active": false,
			"state":  nil,
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"active": state.Status == "running" || state.Status == "queued" || state.Status == "cancelling",
		"state":  state,
	})
}

// ListModels handles GET requests to retrieve registered models/packages in Model Registry.
func (h *ModelHandler) ListModels(c *gin.Context) {
	models, err := h.model.ListModels(c.Request.Context(), strings.TrimSpace(c.Query("task")))
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "model storage is unavailable"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"models": models,
		"count":  len(models),
		"source": "minio-runtime-registry",
	})
}

// GetModelEvaluation handles GET requests to retrieve verified evaluation evidence for a specific package.
func (h *ModelHandler) GetModelEvaluation(c *gin.Context) {
	evaluation, err := h.model.GetModelEvaluation(c.Request.Context(), strings.TrimSpace(c.Param("runtime_package_id")))
	if err != nil {
		if errors.Is(err, provider.ErrObjectNotFound) {
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

// GetModelEvolution handles GET requests to retrieve verified end-to-end lineage and artifact bindings.
func (h *ModelHandler) GetModelEvolution(c *gin.Context) {
	evidence, err := h.model.GetModelEvolution(c.Request.Context(), strings.TrimSpace(c.Param("runtime_package_id")))
	if err != nil {
		if errors.Is(err, provider.ErrObjectNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "model evolution evidence was not found"})
			return
		}
		if errors.Is(err, taxonomy.ErrInvalidRequest) {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "model evolution storage is unavailable"})
		return
	}
	c.JSON(http.StatusOK, evidence)
}

