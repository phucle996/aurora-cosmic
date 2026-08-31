package handler

import (
	"net/http"
	"strings"
	"time"

	"go-api/internal/domain/entity"
	"go-api/internal/domain/service"

	"github.com/gin-gonic/gin"
)

type PreprocessingHandler struct{ preprocessing service.Preprocessing }

func NewPreprocessingHandler(preprocessing service.Preprocessing) *PreprocessingHandler {
	return &PreprocessingHandler{preprocessing: preprocessing}
}

func (h *PreprocessingHandler) Start(c *gin.Context) {
	var request entity.PreprocessingStartRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid preprocessing start request"})
		return
	}
	if request.Mode != "" && request.Mode != "stream" && request.Mode != "batch" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "mode must be stream or batch"})
		return
	}
	if request.WorkerCount < 1 || request.WorkerCount > 64 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "worker_count must be between 1 and 64"})
		return
	}
	request.IngestRunID = strings.TrimSpace(request.IngestRunID)
	request.Prefix = strings.TrimSpace(request.Prefix)
	job, err := h.preprocessing.Start(c.Request.Context(), request)
	if err != nil {
		status := http.StatusServiceUnavailable
		if strings.Contains(err.Error(), "still active") {
			status = http.StatusConflict
		} else if strings.Contains(err.Error(), "must be") || strings.Contains(err.Error(), "not supported") {
			status = http.StatusBadRequest
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusAccepted, job)
}

func (h *PreprocessingHandler) Query(c *gin.Context) {
	graph, err := h.preprocessing.Query(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Prometheus preprocessing observation is unavailable"})
		return
	}
	hops := make([]gin.H, len(graph.Hops))
	for i, hop := range graph.Hops {
		hops[i] = gin.H{"id": hop.ID, "label": hop.Label, "description": hop.Description, "contract": hop.Contract, "status": hop.Status, "input": hop.Input, "output": hop.Output, "observed_at": hop.ObservedAt.Format(time.RFC3339), "metrics": hop.Metrics, "telemetry": hop.Telemetry, "details": hop.Details}
	}
	edges := make([]gin.H, len(graph.Edges))
	for i, edge := range graph.Edges {
		edges[i] = gin.H{"id": edge.ID, "source": edge.Source, "target": edge.Target, "status": edge.Status, "observed_at": edge.ObservedAt.Format(time.RFC3339)}
	}
	var run any
	if graph.Run != nil {
		run = gin.H{"job_id": graph.Run.JobID, "status": graph.Run.Status, "mode": graph.Run.Mode, "worker_count": graph.Run.WorkerCount, "ingest_run_id": graph.Run.IngestRunID, "prefix": graph.Run.Prefix, "started_at": graph.Run.StartedAt.Format(time.RFC3339), "updated_at": graph.Run.UpdatedAt.Format(time.RFC3339), "error": graph.Run.Error}
	}
	progress := gin.H{"bronze_total": graph.Progress.BronzeTotal, "bronze_bytes": graph.Progress.BronzeBytes, "bronze_completed": graph.Progress.BronzeCompleted, "bronze_pending": graph.Progress.BronzePending, "bronze_failed": graph.Progress.BronzeFailed, "bronze_observed": graph.Progress.BronzeObserved, "silver_total": graph.Progress.SilverTotal, "silver_bytes": graph.Progress.SilverBytes, "gold_total": graph.Progress.GoldTotal, "gold_bytes": graph.Progress.GoldBytes, "footprint_observed": graph.Progress.FootprintObserved, "checkpoint_total": graph.Progress.CheckpointTotal, "checkpoint_completed": graph.Progress.CheckpointCompleted, "checkpoint_pending": graph.Progress.CheckpointPending, "checkpoint_failed": graph.Progress.CheckpointFailed, "backlog_pending": graph.Progress.BacklogPending, "backlog_ack_pending": graph.Progress.BacklogAckPending, "items_to_process": graph.Progress.ItemsToProcess, "observed_at": graph.Progress.ObservedAt.Format(time.RFC3339)}
	c.JSON(http.StatusOK, gin.H{"source": graph.Source, "observation_scope": graph.ObservationScope, "status": graph.Status, "observed_at": graph.ObservedAt.Format(time.RFC3339), "run": run, "progress": progress, "runtime": graph.Runtime, "hops": hops, "edges": edges})
}

func (h *PreprocessingHandler) Stop(c *gin.Context) {
	job, err := h.preprocessing.Stop(c.Request.Context(), strings.TrimSpace(c.Param("job_id")))
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusAccepted, job)
}
