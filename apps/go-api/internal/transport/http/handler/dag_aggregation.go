package handler

import (
	"net/http"
	"strings"

	"time"

	"go-api/internal/domain/service"

	"github.com/gin-gonic/gin"
)

// DAGAggregationHandler serves on-demand visual metrics and metadata for DAG hops/steps.
type DAGAggregationHandler struct {
	dagAggregation service.DAGAggregation
}

// NewDAGAggregationHandler creates a new DAGAggregationHandler.
func NewDAGAggregationHandler(dagAggregation service.DAGAggregation) *DAGAggregationHandler {
	return &DAGAggregationHandler{dagAggregation: dagAggregation}
}

// QueryGraph returns the full visual DAG topology graph.
// GET /api/v1/dag/graph
func (h *DAGAggregationHandler) QueryGraph(c *gin.Context) {
	graph, err := h.dagAggregation.QueryGraph(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Prometheus preprocessing observation is unavailable"})
		return
	}
	hops := make([]gin.H, len(graph.Hops))
	for i, hop := range graph.Hops {
		hops[i] = gin.H{"id": hop.ID, "label": hop.Label, "description": hop.Description, "contract": hop.Contract, "status": hop.Status, "input": hop.Input, "output": hop.Output, "observed_at": hop.ObservedAt.Format(time.RFC3339), "metrics": hop.Metrics, "telemetry": hop.Telemetry, "details": hop.Details, "scatter_points": hop.ScatterPoints, "tpf_transform_points": hop.TPFTransformPoints, "materialization_points": hop.MaterializationPoints, "encode_failures": hop.EncodeFailures, "silver_failures": hop.SilverFailures, "checkpoint_points": hop.CheckpointPoints}
	}
	edges := make([]gin.H, len(graph.Edges))
	for i, edge := range graph.Edges {
		edges[i] = gin.H{"id": edge.ID, "source": edge.Source, "target": edge.Target, "status": edge.Status, "observed_at": edge.ObservedAt.Format(time.RFC3339)}
	}
	var run any
	if graph.Run != nil {
		run = gin.H{
			"ticket_id":     graph.Run.TicketID,
			"status":        graph.Run.Status,
			"mode":          graph.Run.Mode,
			"worker_count":  graph.Run.WorkerCount,
			"ingest_run_id": graph.Run.IngestRunID,
			"prefix":        graph.Run.Prefix,
			"started_at":    graph.Run.StartedAt.Format(time.RFC3339),
			"updated_at":    graph.Run.UpdatedAt.Format(time.RFC3339),
			"error":         graph.Run.Error,
		}
	}
	progress := gin.H{"bronze_total": graph.Progress.BronzeTotal, "bronze_bytes": graph.Progress.BronzeBytes, "bronze_completed": graph.Progress.BronzeCompleted, "bronze_pending": graph.Progress.BronzePending, "bronze_failed": graph.Progress.BronzeFailed, "bronze_observed": graph.Progress.BronzeObserved, "bronze_lightcurves": graph.Progress.BronzeLightCurves, "bronze_target_pixels": graph.Progress.BronzeTargetPixels, "silver_total": graph.Progress.SilverTotal, "silver_bytes": graph.Progress.SilverBytes, "silver_lightcurves": graph.Progress.SilverLightCurves, "silver_target_pixels": graph.Progress.SilverTargetPixels, "gold_total": graph.Progress.GoldTotal, "gold_bytes": graph.Progress.GoldBytes, "footprint_observed": graph.Progress.FootprintObserved, "checkpoint_total": graph.Progress.CheckpointTotal, "checkpoint_completed": graph.Progress.CheckpointCompleted, "checkpoint_pending": graph.Progress.CheckpointPending, "checkpoint_failed": graph.Progress.CheckpointFailed, "completed_lightcurves": graph.Progress.CompletedLightCurves, "completed_target_pixels": graph.Progress.CompletedTargetPixels, "backlog_pending": graph.Progress.BacklogPending, "backlog_ack_pending": graph.Progress.BacklogAckPending, "items_to_process": graph.Progress.ItemsToProcess, "observed_at": graph.Progress.ObservedAt.Format(time.RFC3339)}
	c.JSON(http.StatusOK, gin.H{"status": graph.Status, "observed_at": graph.ObservedAt.Format(time.RFC3339), "run": run, "progress": progress, "runtime": graph.Runtime, "hops": hops, "edges": edges})
}

// QueryHop returns on-demand telemetry, contracts, and PromQL-aggregated metrics for a single DAG step.
// GET /api/v1/dag/hops/:hop_id?ticket_id=<ticket_id>
func (h *DAGAggregationHandler) QueryHop(c *gin.Context) {
	hopID := strings.TrimSpace(c.Param("hop_id"))
	if hopID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "hop_id is required"})
		return
	}

	ticketID := strings.TrimSpace(c.Query("ticket_id"))

	hop, err := h.dagAggregation.AggregateHopMetrics(c.Request.Context(), ticketID, hopID)
	if err != nil {
		if strings.Contains(err.Error(), "unknown") {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, hop)
}
