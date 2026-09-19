package service

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strings"
	"sync"
	"time"

	"go-api/internal/domain/entity"
	"go-api/internal/domain/repo"
	domainService "go-api/internal/domain/service"
	"go-api/internal/provider"
)

const (
	dagRuntimeWindow = 60 * time.Second
	dagTraceLimit    = 50
)

// DAGAggregationService handles visual data aggregation for DAG hops/steps on-demand.
// It is fully decoupled from the core workflow execution and serves charts and telemetry
// tailored to the requested step and ticket timeline.
type DAGAggregationService struct {
	preprocessing domainService.Preprocessing
	prometheus    repo.PrometheusQuerier
	objects       provider.ObjectStorage

	runtimeMu       sync.RWMutex
	runtime         entity.PreprocessingRuntimeSnapshot
	completionTimes []time.Time
}

// NewDAGAggregationService creates a new visual DAG aggregation service.
func NewDAGAggregationService(preprocessing domainService.Preprocessing, prometheus repo.PrometheusQuerier, objects provider.ObjectStorage) *DAGAggregationService {
	return &DAGAggregationService{
		preprocessing: preprocessing,
		prometheus:    prometheus,
		objects:       objects,
	}
}

// ObserveRuntime receives real-time worker events from NATS and maintains the live visual worker pool and trace.
func (s *DAGAggregationService) ObserveRuntime(event entity.PreprocessingRuntimeEvent) {
	if event.TicketID != "" && s.preprocessing != nil {
		if activeJob, err := s.preprocessing.GetActiveJob(context.Background()); err == nil && activeJob != nil && activeJob.TicketID != "" {
			if activeJob.TicketID != event.TicketID {
				return
			}
		}
	}

	s.runtimeMu.Lock()
	defer s.runtimeMu.Unlock()

	idx := -1
	for i := range s.runtime.Workers {
		if s.runtime.Workers[i].WorkerID == event.WorkerID {
			idx = i
			break
		}
	}
	if idx == -1 {
		s.runtime.Workers = append(s.runtime.Workers, entity.PreprocessingWorkerRuntime{
			WorkerID:  event.WorkerID,
			State:     "idle",
			UpdatedAt: event.OccurredAt,
		})
		sort.Slice(s.runtime.Workers, func(i, j int) bool {
			return s.runtime.Workers[i].WorkerID < s.runtime.Workers[j].WorkerID
		})
		for i := range s.runtime.Workers {
			if s.runtime.Workers[i].WorkerID == event.WorkerID {
				idx = i
				break
			}
		}
	}

	w := &s.runtime.Workers[idx]
	w.UpdatedAt = event.OccurredAt

	switch event.Event {
	case "worker_spawned":
		w.State = "idle"
	case "file_started", "stage_changed":
		w.State = "processing"
		w.ProductKind = event.ProductKind
		w.ObjectKey = event.ObjectKey
		w.Stage = event.Stage
		if event.Event == "file_started" {
			w.StartedAt = event.OccurredAt
		}
	case "file_completed":
		w.State = "idle"
		w.LastDurationMS = event.ElapsedMS
		w.Completed++
		w.ObjectKey = ""
		w.Stage = "completed"
		s.runtime.Completed++
		s.completionTimes = append(s.completionTimes, event.OccurredAt)
	case "file_failed":
		w.State = "failed"
		w.LastDurationMS = event.ElapsedMS
		w.Failed++
		w.Stage = "failed"
		s.runtime.Failed++
	case "worker_stopped", "worker_killed":
		w.State = "stopped"
		w.ObjectKey = ""
		w.Stage = ""
	case "worker_idle":
		w.State = "idle"
		w.ObjectKey = ""
	}

	s.runtime.ActualWorkers, s.runtime.Processing = 0, 0
	for i := range s.runtime.Workers {
		if s.runtime.Workers[i].State != "stopped" {
			s.runtime.ActualWorkers++
		}
		if s.runtime.Workers[i].State == "processing" {
			s.runtime.Processing++
		}
	}

	cutoff := event.OccurredAt.Add(-dagRuntimeWindow)
	kept := s.completionTimes[:0]
	for _, completedAt := range s.completionTimes {
		if completedAt.After(cutoff) {
			kept = append(kept, completedAt)
		}
	}
	s.completionTimes = kept
	s.runtime.Throughput = float64(len(kept)) / dagRuntimeWindow.Seconds()

	s.runtime.Trace = append(s.runtime.Trace, event)
	if len(s.runtime.Trace) > dagTraceLimit {
		s.runtime.Trace = s.runtime.Trace[len(s.runtime.Trace)-dagTraceLimit:]
	}
	s.runtime.ObservedAt = event.OccurredAt
}

// QueryGraph assembles the full Pipeline DAG topology with real-time status, metrics and
// telemetry. Metrics are strictly derived from Prometheus over the ticket runtime, while
// worker pool snapshot comes from the lightweight in-memory Observer.
func (s *DAGAggregationService) QueryGraph(ctx context.Context) (*entity.PreprocessingGraph, error) {
	var runtimeJob *entity.PreprocessingControlJob
	if s.preprocessing != nil {
		runtimeJob, _ = s.preprocessing.GetActiveJob(ctx)
	}

	s.runtimeMu.RLock()
	runtime := s.runtime
	s.runtimeMu.RUnlock()

	ticketID := ""
	if runtimeJob != nil {
		ticketID = runtimeJob.TicketID
	}
	start, end, window := s.resolveTicketTimeRange(ctx, ticketID)

	observations := make(map[string][]entity.MonitoringPoint)
	values := make(map[string]float64)
	observed := false

	if s.prometheus != nil {
		step := time.Duration(math.Max(15, end.Sub(start).Seconds()/60)) * time.Second
		if pts, err := s.prometheus.QueryRange(ctx, `sum(rate(aurora_preprocessor_products_total{status="success"}[1m]))`, start, end, step); err == nil && len(pts) > 0 {
			values["throughput"] = pts[len(pts)-1].Value
			observations["throughput"] = pts
			observed = true
		}
		if pts, err := s.prometheus.QueryRange(ctx, `sum(aurora_preprocessor_inflight_workers)`, start, end, step); err == nil && len(pts) > 0 {
			values["inflight"] = pts[len(pts)-1].Value
			observed = true
		}
		if pts, err := s.prometheus.QueryRange(ctx, `sum(rate(aurora_preprocessor_errors_total[1m]))`, start, end, step); err == nil && len(pts) > 0 {
			values["errors"] = pts[len(pts)-1].Value
		}
		if pts, err := s.prometheus.QueryRange(ctx, `sum(aurora_preprocessor_queue_depth)`, start, end, step); err == nil && len(pts) > 0 {
			values["queue"] = pts[len(pts)-1].Value
		}
		if pts, err := s.prometheus.QueryRange(ctx, `sum(aurora_preprocessor_backlog_pending)`, start, end, step); err == nil && len(pts) > 0 {
			values["backlog"] = pts[len(pts)-1].Value
		}

		// Cumulative totals for the ENTIRE ticket lifespan
		if pts, err := s.prometheus.QueryRange(ctx, fmt.Sprintf(`sum(increase(aurora_preprocessor_products_total[%s]))`, window), start, end, step); err == nil && len(pts) > 0 {
			values["bronze_total_files"] = pts[len(pts)-1].Value
		}
		if pts, err := s.prometheus.QueryRange(ctx, fmt.Sprintf(`sum(increase(aurora_preprocessor_products_total{kind="lightcurve"}[%s]))`, window), start, end, step); err == nil && len(pts) > 0 {
			values["bronze_lightcurves"] = pts[len(pts)-1].Value
		}
		if pts, err := s.prometheus.QueryRange(ctx, fmt.Sprintf(`sum(increase(aurora_preprocessor_products_total{kind="target_pixel"}[%s]))`, window), start, end, step); err == nil && len(pts) > 0 {
			values["bronze_target_pixels"] = pts[len(pts)-1].Value
		}
		if pts, err := s.prometheus.QueryRange(ctx, fmt.Sprintf(`sum(increase(aurora_preprocessor_products_total{status="failed"}[%s]))`, window), start, end, step); err == nil && len(pts) > 0 {
			values["failed_files"] = pts[len(pts)-1].Value
		}
		if pts, err := s.prometheus.QueryRange(ctx, fmt.Sprintf(`sum(increase(aurora_preprocessor_bytes_total{stage="bronze"}[%s]))`, window), start, end, step); err == nil && len(pts) > 0 {
			values["bronze_bytes"] = pts[len(pts)-1].Value
		}
		if pts, err := s.prometheus.QueryRange(ctx, fmt.Sprintf(`sum(increase(aurora_preprocessor_bytes_total{stage="silver"}[%s]))`, window), start, end, step); err == nil && len(pts) > 0 {
			values["silver_bytes"] = pts[len(pts)-1].Value
		}
		if pts, err := s.prometheus.QueryRange(ctx, fmt.Sprintf(`sum(increase(aurora_preprocessor_products_total{kind="lightcurve",status="success"}[%s]))`, window), start, end, step); err == nil && len(pts) > 0 {
			values["completed_lightcurves"] = pts[len(pts)-1].Value
		}
		if pts, err := s.prometheus.QueryRange(ctx, fmt.Sprintf(`sum(increase(aurora_preprocessor_products_total{kind="target_pixel",status="success"}[%s]))`, window), start, end, step); err == nil && len(pts) > 0 {
			values["completed_target_pixels"] = pts[len(pts)-1].Value
		}
	}

	if !runtime.ObservedAt.IsZero() {
		if values["throughput"] == 0 {
			values["throughput"] = runtime.Throughput
		}
		if values["inflight"] == 0 {
			values["inflight"] = float64(runtime.Processing)
		}
		if values["errors"] == 0 {
			values["errors"] = float64(runtime.Failed)
		}
		observed = true
		if len(observations["throughput"]) == 0 {
			observations["throughput"] = []entity.MonitoringPoint{
				{Timestamp: float64(end.Unix()), Value: runtime.Throughput},
			}
		}
	}

	bronzeTotal := int64(values["bronze_total_files"])
	bronzeLC := int64(values["bronze_lightcurves"])
	bronzeTPF := int64(values["bronze_target_pixels"])
	bronzeFailed := int64(values["failed_files"])
	bronzeBytes := int64(values["bronze_bytes"])
	silverBytes := int64(values["silver_bytes"])
	compLC := int64(values["completed_lightcurves"])
	compTPF := int64(values["completed_target_pixels"])
	compTotal := compLC + compTPF

	runtimeProgress := entity.PreprocessingProgress{
		BronzeObserved:        bronzeTotal > 0 || bronzeBytes > 0,
		FootprintObserved:     silverBytes > 0,
		BronzeTotal:           int(bronzeTotal),
		BronzeCompleted:       int(compTotal),
		BronzePending:         int(math.Max(0, float64(bronzeTotal-compTotal-bronzeFailed))),
		BronzeFailed:          int(bronzeFailed),
		BronzeLightCurves:     int(bronzeLC),
		BronzeTargetPixels:    int(bronzeTPF),
		BronzeBytes:           bronzeBytes,
		SilverTotal:           int(compTotal),
		SilverBytes:           silverBytes,
		SilverLightCurves:     int(compLC),
		SilverTargetPixels:    int(compTPF),
		CheckpointTotal:       int(bronzeTotal),
		CheckpointCompleted:   int(compTotal),
		CheckpointPending:     int(math.Max(0, float64(bronzeTotal-compTotal-bronzeFailed))),
		CheckpointFailed:      int(bronzeFailed),
		CompletedLightCurves:  int(compLC),
		CompletedTargetPixels: int(compTPF),
		BronzeConsumerPending: int64(values["backlog"]),
		ObservedAt:            end,
	}
	if runtimeProgress.BronzeObserved || runtimeProgress.FootprintObserved {
		observed = true
	}

	// Infer overall pipeline status
	status := dagPipelineStatus(values, observed, end)
	if runtimeJob != nil && strings.EqualFold(runtimeJob.Status, "running") {
		if status == "not_observed" {
			status = "running"
		}
	}
	if runtimeJob != nil && runtimeJob.Status == "completed" {
		if runtimeProgress.BronzeObserved && runtimeProgress.FootprintObserved && runtimeProgress.BronzeTotal > 0 && runtimeProgress.CheckpointCompleted > 0 && runtimeProgress.SilverTotal > 0 && runtimeProgress.SilverBytes > 0 {
			status = "completed"
		} else {
			status = "not_observed"
		}
	}
	if runtimeJob != nil && runtimeJob.Status == "failed" {
		status = "failed"
	}
	if runtimeJob != nil && (runtimeJob.Status == "cancelling" || runtimeJob.Status == "canceled" || runtimeJob.Status == "cancelled") {
		status = runtimeJob.Status
	}

	// Build Pipeline DAG Hops and topology edges
	hops := dagHops(values, observations, end, nil, runtimeProgress)
	topology := [][2]string{
		{"bronze", "route"},
		{"route", "lc-quality"}, {"lc-quality", "lc-transform"}, {"lc-transform", "lc-parquet"}, {"lc-parquet", "silver"},
		{"route", "tpf-quality"}, {"tpf-quality", "tpf-transform"}, {"tpf-transform", "tpf-parquet"}, {"tpf-parquet", "silver"},
		{"silver", "checkpoint"}, {"checkpoint", "lineage"}, {"lineage", "event"}, {"event", "ack"},
	}
	edges := make([]entity.PreprocessingEdge, 0, len(topology))
	for i, connection := range topology {
		edges = append(edges, entity.PreprocessingEdge{
			ID:         fmt.Sprintf("edge-%d", i),
			Source:     connection[0],
			Target:     connection[1],
			Status:     status,
			ObservedAt: end,
		})
	}

	return &entity.PreprocessingGraph{
		Status:     status,
		ObservedAt: end,
		Run:        runtimeJob,
		Progress:   runtimeProgress,
		Runtime:    runtime,
		Hops:       hops,
		Edges:      edges,
	}, nil
}

// HopMetadata defines the visual metadata for each pipeline DAG step.
type HopMetadata struct {
	ID          string
	Label       string
	Description string
	Contract    string
	Input       string
	Output      string
}

var hopCatalog = map[string]HopMetadata{
	"bronze": {
		ID:          "bronze",
		Label:       "Bronze verify & fetch",
		Description: "Verify object identity, size and checksum before local staging",
		Contract:    "bronze/tess/<product>/sector=<sector>/tic=<tic>/",
		Input:       "NASA MAST FITS",
		Output:      "Verified local FITS",
	},
	"route": {
		ID:          "route",
		Label:       "Product router & FITS reader",
		Description: "Route each verified product to the full LC decoder or bounded-memory TPF chunk reader",
		Contract:    "fits-product-router-v1",
		Input:       "Verified local FITS",
		Output:      "Typed LC stream or TPF chunks",
	},
	"lc-quality": {
		ID:          "lc-quality",
		Label:       "LC cadence quality control",
		Description: "Apply quality bitmask, finite-value checks, time validity and cadence deduplication",
		Contract:    "quality-flag-bitmask-v1/lc",
		Input:       "Decoded Light Curve",
		Output:      "Quality-valid LC cadences",
	},
	"lc-transform": {
		ID:          "lc-transform",
		Label:       "LC normalization & sigma clip",
		Description: "Normalize relative flux by its median and optionally remove configured sigma outliers",
		Contract:    "lc-preprocess-v1",
		Input:       "Quality-valid LC cadences",
		Output:      "Normalized LC samples",
	},
	"lc-parquet": {
		ID:          "lc-parquet",
		Label:       "LC Parquet encode",
		Description: "Encode the complete normalized Light Curve as a checksummed ZSTD Parquet artifact",
		Contract:    "silver-lightcurve-v1",
		Input:       "Normalized LC samples",
		Output:      "Local LC Parquet",
	},
	"tpf-quality": {
		ID:          "tpf-quality",
		Label:       "TPF chunk decode & cadence QC",
		Description: "Read bounded cadence chunks and apply quality, finite-time and time-validity filters",
		Contract:    "quality-flag-bitmask-v1/tpf-chunk",
		Input:       "Target Pixel FITS",
		Output:      "Quality-valid TPF chunks",
	},
	"tpf-transform": {
		ID:          "tpf-transform",
		Label:       "TPF temporal pixel normalization",
		Description: "Normalize each bounded Target Pixel chunk against its temporal pixel reference",
		Contract:    "tpf-preprocess-v2-chunked",
		Input:       "Quality-valid TPF chunk",
		Output:      "Normalized TPF chunk",
	},
	"tpf-parquet": {
		ID:          "tpf-parquet",
		Label:       "TPF row-group append & finalize",
		Description: "Append each normalized chunk as a Parquet row group, then finalize the complete artifact",
		Contract:    "silver-target-pixel-v1/chunked",
		Input:       "Normalized TPF chunks",
		Output:      "Local TPF Parquet",
	},
	"silver": {
		ID:          "silver",
		Label:       "Silver upload & integrity verify",
		Description: "Upload the finalized LC or TPF Parquet object and verify durable size, checksum and metadata",
		Contract:    "silver/tess/<product>/processor=<version>/",
		Input:       "Finalized local Parquet",
		Output:      "Verified Silver object",
	},
	"checkpoint": {
		ID:          "checkpoint",
		Label:       "Checkpoint",
		Description: "Persist crash-safe processing state",
		Contract:    "checkpoints/preprocessing/objects/<id>.json",
		Input:       "Silver verification",
		Output:      "Completed checkpoint",
	},
	"lineage": {
		ID:          "lineage",
		Label:       "Lineage & stored footprint",
		Description: "Commit source → Bronze → Silver identity and measure persisted MinIO tiers",
		Contract:    "lineage/v1/<lineage-id>.json",
		Input:       "Checkpoint + checksums",
		Output:      "Committed lineage",
	},
	"event": {
		ID:          "event",
		Label:       "Silver event",
		Description: "Publish downstream-ready event",
		Contract:    "aurora.v1.silver.<product>.ready",
		Input:       "Committed lineage",
		Output:      "Published event",
	},
	"ack": {
		ID:          "ack",
		Label:       "Bronze ACK",
		Description: "Acknowledge only after durable output",
		Contract:    "NATS durable consumer ACK",
		Input:       "Published event",
		Output:      "Bronze message ACKed",
	},
}

// AggregateHopMetrics executes the dedicated aggregation flow for a single DAG hop on-demand.
func (s *DAGAggregationService) AggregateHopMetrics(ctx context.Context, ticketID string, hopID string) (*entity.PreprocessingHop, error) {
	meta, exists := hopCatalog[hopID]
	if !exists {
		return nil, fmt.Errorf("unknown pipeline DAG hop %q", hopID)
	}

	start, end, window := s.resolveTicketTimeRange(ctx, ticketID)
	hop := &entity.PreprocessingHop{
		ID:          meta.ID,
		Label:       meta.Label,
		Description: meta.Description,
		Contract:    meta.Contract,
		Input:       meta.Input,
		Output:      meta.Output,
		Status:      "observed",
		ObservedAt:  end,
		Metrics:     make(map[string]float64),
		Telemetry:   make(map[string][]entity.MonitoringPoint),
		Details:     make(map[string]string),
	}

	switch hopID {
	case "bronze":
		s.aggregateBronzeHop(ctx, hop, start, end, window)
	case "route":
		s.aggregateRouteHop(ctx, hop, start, end, window)
	case "lc-quality", "tpf-quality":
		s.aggregateQualityHop(ctx, hop, start, end, window)
	case "lc-transform":
		s.aggregateLCTransformHop(ctx, hop, start, end, window)
	case "lc-parquet":
		s.aggregateLCParquetHop(ctx, hop, start, end, window)
	case "tpf-transform":
		s.aggregateTPFTransformHop(ctx, hop, start, end, window)
	case "tpf-parquet":
		s.aggregateTPFParquetHop(ctx, hop, start, end, window)
	case "silver":
		s.aggregateSilverHop(ctx, hop, start, end, window)
	case "checkpoint":
		s.aggregateCheckpointHop(ctx, hop, start, end, window)
	case "lineage":
		s.aggregateLineageHop(ctx, hop, start, end, window)
	case "event":
		s.aggregateEventHop(ctx, hop, start, end, window)
	case "ack":
		s.aggregateAckHop(ctx, hop, start, end, window)
	default:
		s.queryMetric(ctx, hop, "throughput", `sum(rate(aurora_preprocessor_products_total{status="success"}[1m]))`, start, end)
	}

	return hop, nil
}

func (s *DAGAggregationService) resolveTicketTimeRange(ctx context.Context, ticketID string) (time.Time, time.Time, string) {
	end := time.Now().UTC()
	start := end.Add(-30 * time.Minute)

	ticketID = strings.TrimSpace(ticketID)
	if ticketID == "" && s.objects != nil {
		if data, err := s.objects.GetObject(ctx, "checkpoints/preprocessing/current.json"); err == nil && len(data) > 0 {
			var pointer struct {
				ActiveRunID string `json:"active_run_id"`
			}
			if json.Unmarshal(data, &pointer) == nil && pointer.ActiveRunID != "" {
				ticketID = pointer.ActiveRunID
			}
		}
	}

	if ticketID != "" && s.objects != nil {
		runData, err := s.objects.GetObject(ctx, "checkpoints/preprocessing/runs/"+ticketID+".json")
		if err == nil && len(runData) > 0 {
			var checkpoint struct {
				StartedAt time.Time `json:"started_at"`
				UpdatedAt time.Time `json:"updated_at"`
				Status    string    `json:"status"`
			}
			if err := json.Unmarshal(runData, &checkpoint); err == nil && !checkpoint.StartedAt.IsZero() {
				start = checkpoint.StartedAt
				if strings.EqualFold(checkpoint.Status, "completed") || strings.EqualFold(checkpoint.Status, "stopped") || strings.EqualFold(checkpoint.Status, "failed") || strings.Contains(strings.ToLower(checkpoint.Status), "cancel") {
					if !checkpoint.UpdatedAt.IsZero() && checkpoint.UpdatedAt.After(start) {
						end = checkpoint.UpdatedAt
					}
				} else {
					end = time.Now().UTC()
				}
			}
		}
	}

	duration := end.Sub(start)
	if duration < 30*time.Second {
		duration = 30 * time.Second
	}
	windowStr := fmt.Sprintf("%ds", int(duration.Seconds()))
	return start, end, windowStr
}

func (s *DAGAggregationService) queryMetric(ctx context.Context, hop *entity.PreprocessingHop, key string, query string, start, end time.Time) {
	if s.prometheus == nil {
		return
	}
	step := time.Duration(math.Max(15, end.Sub(start).Seconds()/60)) * time.Second
	points, err := s.prometheus.QueryRange(ctx, query, start, end, step)
	if err != nil || len(points) == 0 {
		return
	}
	finite := make([]entity.MonitoringPoint, 0, len(points))
	var lastVal float64
	for _, pt := range points {
		if !math.IsNaN(pt.Value) && !math.IsInf(pt.Value, 0) {
			finite = append(finite, pt)
			lastVal = pt.Value
		}
	}
	if len(finite) > 0 {
		hop.Telemetry[key] = finite
		hop.Metrics[key] = lastVal
	}
}

// --- Specific Hop Aggregation Handlers ---

func (s *DAGAggregationService) aggregateBronzeHop(ctx context.Context, hop *entity.PreprocessingHop, start, end time.Time, window string) {
	s.queryMetric(ctx, hop, "bronze_bytes_rate", `sum(rate(aurora_preprocessor_bytes_total{stage="bronze"}[2m]))`, start, end)
	s.queryMetric(ctx, hop, "throughput", `sum(rate(aurora_preprocessor_products_total[1m]))`, start, end)
	s.queryMetric(ctx, hop, "total_files", fmt.Sprintf(`sum(increase(aurora_preprocessor_products_total[%s]))`, window), start, end)
	s.queryMetric(ctx, hop, "lightcurve_files", fmt.Sprintf(`sum(increase(aurora_preprocessor_products_total{kind="lightcurve"}[%s]))`, window), start, end)
	s.queryMetric(ctx, hop, "target_pixel_files", fmt.Sprintf(`sum(increase(aurora_preprocessor_products_total{kind="target_pixel"}[%s]))`, window), start, end)
	s.queryMetric(ctx, hop, "failed_files", fmt.Sprintf(`sum(increase(aurora_preprocessor_products_total{status="failed"}[%s]))`, window), start, end)
	s.queryMetric(ctx, hop, "bronze_bytes", fmt.Sprintf(`sum(increase(aurora_preprocessor_bytes_total{stage="bronze"}[%s]))`, window), start, end)
}

func (s *DAGAggregationService) aggregateRouteHop(ctx context.Context, hop *entity.PreprocessingHop, start, end time.Time, window string) {
	s.queryMetric(ctx, hop, "throughput", `sum(rate(aurora_preprocessor_products_total[1m]))`, start, end)
	s.queryMetric(ctx, hop, "total_files", fmt.Sprintf(`sum(increase(aurora_preprocessor_products_total[%s]))`, window), start, end)
	s.queryMetric(ctx, hop, "lightcurve_files", fmt.Sprintf(`sum(increase(aurora_preprocessor_products_total{kind="lightcurve"}[%s]))`, window), start, end)
	s.queryMetric(ctx, hop, "target_pixel_files", fmt.Sprintf(`sum(increase(aurora_preprocessor_products_total{kind="target_pixel"}[%s]))`, window), start, end)
}

func (s *DAGAggregationService) aggregateQualityHop(ctx context.Context, hop *entity.PreprocessingHop, start, end time.Time, window string) {
	if strings.Contains(hop.ID, "lc") {
		s.queryMetric(ctx, hop, "lc_input_rate", `sum(rate(aurora_preprocessor_science_samples_total{kind="lightcurve",outcome="input"}[2m]))`, start, end)
		s.queryMetric(ctx, hop, "lc_quality_removed_rate", `sum(rate(aurora_preprocessor_science_samples_total{kind="lightcurve",outcome="quality_removed"}[2m]))`, start, end)
		s.queryMetric(ctx, hop, "lc_invalid_removed_rate", `sum(rate(aurora_preprocessor_science_samples_total{kind="lightcurve",outcome="invalid_removed"}[2m]))`, start, end)
		s.queryMetric(ctx, hop, "lc_nonfinite_removed_rate", `sum(rate(aurora_preprocessor_science_samples_total{kind="lightcurve",outcome="nonfinite_removed"}[2m]))`, start, end)
		s.queryMetric(ctx, hop, "lc_nonpositive_removed_rate", `sum(rate(aurora_preprocessor_science_samples_total{kind="lightcurve",outcome="nonpositive_removed"}[2m]))`, start, end)

		s.queryMetric(ctx, hop, "lc_input_total", fmt.Sprintf(`sum(increase(aurora_preprocessor_science_samples_total{kind="lightcurve",outcome="input"}[%s]))`, window), start, end)
		s.queryMetric(ctx, hop, "lc_quality_removed_total", fmt.Sprintf(`sum(increase(aurora_preprocessor_science_samples_total{kind="lightcurve",outcome="quality_removed"}[%s]))`, window), start, end)
		s.queryMetric(ctx, hop, "lc_invalid_removed_total", fmt.Sprintf(`sum(increase(aurora_preprocessor_science_samples_total{kind="lightcurve",outcome="invalid_removed"}[%s]))`, window), start, end)
		s.queryMetric(ctx, hop, "lc_nonfinite_removed_total", fmt.Sprintf(`sum(increase(aurora_preprocessor_science_samples_total{kind="lightcurve",outcome="nonfinite_removed"}[%s]))`, window), start, end)
		s.queryMetric(ctx, hop, "lc_nonpositive_removed_total", fmt.Sprintf(`sum(increase(aurora_preprocessor_science_samples_total{kind="lightcurve",outcome="nonpositive_removed"}[%s]))`, window), start, end)
		s.queryMetric(ctx, hop, "completed_lightcurves", fmt.Sprintf(`sum(increase(aurora_preprocessor_products_total{kind="lightcurve",status="success"}[%s]))`, window), start, end)
	} else {
		s.queryMetric(ctx, hop, "tpf_input_rate", `sum(rate(aurora_preprocessor_science_samples_total{kind="target_pixel",outcome="input"}[2m]))`, start, end)
		s.queryMetric(ctx, hop, "tpf_quality_removed_rate", `sum(rate(aurora_preprocessor_science_samples_total{kind="target_pixel",outcome="quality_removed"}[2m]))`, start, end)
		s.queryMetric(ctx, hop, "tpf_invalid_removed_rate", `sum(rate(aurora_preprocessor_science_samples_total{kind="target_pixel",outcome="invalid_removed"}[2m]))`, start, end)
		s.queryMetric(ctx, hop, "tpf_nonfinite_removed_rate", `sum(rate(aurora_preprocessor_science_samples_total{kind="target_pixel",outcome="nonfinite_removed"}[2m]))`, start, end)
		s.queryMetric(ctx, hop, "tpf_nonpositive_removed_rate", `sum(rate(aurora_preprocessor_science_samples_total{kind="target_pixel",outcome="nonpositive_removed"}[2m]))`, start, end)

		s.queryMetric(ctx, hop, "tpf_input_total", fmt.Sprintf(`sum(increase(aurora_preprocessor_science_samples_total{kind="target_pixel",outcome="input"}[%s]))`, window), start, end)
		s.queryMetric(ctx, hop, "tpf_quality_removed_total", fmt.Sprintf(`sum(increase(aurora_preprocessor_science_samples_total{kind="target_pixel",outcome="quality_removed"}[%s]))`, window), start, end)
		s.queryMetric(ctx, hop, "tpf_invalid_removed_total", fmt.Sprintf(`sum(increase(aurora_preprocessor_science_samples_total{kind="target_pixel",outcome="invalid_removed"}[%s]))`, window), start, end)
		s.queryMetric(ctx, hop, "tpf_nonfinite_removed_total", fmt.Sprintf(`sum(increase(aurora_preprocessor_science_samples_total{kind="target_pixel",outcome="nonfinite_removed"}[%s]))`, window), start, end)
		s.queryMetric(ctx, hop, "tpf_nonpositive_removed_total", fmt.Sprintf(`sum(increase(aurora_preprocessor_science_samples_total{kind="target_pixel",outcome="nonpositive_removed"}[%s]))`, window), start, end)
		s.queryMetric(ctx, hop, "completed_target_pixels", fmt.Sprintf(`sum(increase(aurora_preprocessor_products_total{kind="target_pixel",status="success"}[%s]))`, window), start, end)
	}
	s.queryMetric(ctx, hop, "failed_products", fmt.Sprintf(`sum(increase(aurora_preprocessor_products_total{status="failed"}[%s]))`, window), start, end)
}

func (s *DAGAggregationService) aggregateLCTransformHop(ctx context.Context, hop *entity.PreprocessingHop, start, end time.Time, window string) {
	s.queryMetric(ctx, hop, "lc_output_rate", `sum(rate(aurora_preprocessor_science_samples_total{kind="lightcurve",outcome="output"}[2m]))`, start, end)
	s.queryMetric(ctx, hop, "lc_outlier_removed_rate", `sum(rate(aurora_preprocessor_science_samples_total{kind="lightcurve",outcome="outlier_removed"}[2m]))`, start, end)
	s.queryMetric(ctx, hop, "lc_sigma_clip_3_4_rate", `sum(rate(aurora_preprocessor_science_samples_total{kind="lightcurve",outcome="sigma_clip_3_4_removed"}[2m]))`, start, end)
	s.queryMetric(ctx, hop, "lc_scatter_before_p50", `histogram_quantile(0.50, sum by (le) (rate(aurora_preprocessor_lc_normalized_scatter_ppm_bucket{phase="before_clip"}[15m])))`, start, end)
	s.queryMetric(ctx, hop, "lc_scatter_after_p50", `histogram_quantile(0.50, sum by (le) (rate(aurora_preprocessor_lc_normalized_scatter_ppm_bucket{phase="after_clip"}[15m])))`, start, end)
	s.queryMetric(ctx, hop, "lc_duration_p95", `histogram_quantile(0.95, sum by (le) (rate(aurora_preprocessor_processing_duration_seconds_bucket{kind="lightcurve"}[5m])))`, start, end)

	s.queryMetric(ctx, hop, "lc_output_total", fmt.Sprintf(`sum(increase(aurora_preprocessor_science_samples_total{kind="lightcurve",outcome="output"}[%s]))`, window), start, end)
	s.queryMetric(ctx, hop, "lc_outlier_removed_total", fmt.Sprintf(`sum(increase(aurora_preprocessor_science_samples_total{kind="lightcurve",outcome="outlier_removed"}[%s]))`, window), start, end)
	s.queryMetric(ctx, hop, "completed_lightcurves", fmt.Sprintf(`sum(increase(aurora_preprocessor_products_total{kind="lightcurve",status="success"}[%s]))`, window), start, end)
}

func (s *DAGAggregationService) aggregateLCParquetHop(ctx context.Context, hop *entity.PreprocessingHop, start, end time.Time, window string) {
	s.queryMetric(ctx, hop, "silver_bytes_rate", `sum(rate(aurora_preprocessor_bytes_total{stage="silver"}[2m]))`, start, end)
	s.queryMetric(ctx, hop, "lc_duration_p95", `histogram_quantile(0.95, sum by (le) (rate(aurora_preprocessor_processing_duration_seconds_bucket{kind="lightcurve"}[5m])))`, start, end)
	s.queryMetric(ctx, hop, "silver_bytes", fmt.Sprintf(`sum(increase(aurora_preprocessor_bytes_total{stage="silver",kind="lightcurve"}[%s]))`, window), start, end)
	s.queryMetric(ctx, hop, "completed_lightcurves", fmt.Sprintf(`sum(increase(aurora_preprocessor_products_total{kind="lightcurve",status="success"}[%s]))`, window), start, end)
}

func (s *DAGAggregationService) aggregateTPFTransformHop(ctx context.Context, hop *entity.PreprocessingHop, start, end time.Time, window string) {
	s.queryMetric(ctx, hop, "tpf_finite_pixel_fraction", `max(aurora_preprocessor_finite_pixel_fraction{kind="target_pixel"})`, start, end)
	s.queryMetric(ctx, hop, "tpf_pixel_input_rate", `sum(rate(aurora_preprocessor_tpf_normalization_pixels_total{outcome="input"}[2m]))`, start, end)
	s.queryMetric(ctx, hop, "tpf_pixel_retained_rate", `sum(rate(aurora_preprocessor_tpf_normalization_pixels_total{outcome="retained"}[2m]))`, start, end)
	s.queryMetric(ctx, hop, "tpf_scatter_p50", `histogram_quantile(0.50, sum by (le) (rate(aurora_preprocessor_tpf_pixel_scatter_mad_ppm_bucket{quantile="p50"}[15m])))`, start, end)
	s.queryMetric(ctx, hop, "tpf_reference_drift_p95", `histogram_quantile(0.95, sum by (le) (rate(aurora_preprocessor_tpf_reference_drift_ppm_bucket{quantile="p95"}[15m])))`, start, end)
	s.queryMetric(ctx, hop, "tpf_boundary_jump_p95", `histogram_quantile(0.95, sum by (le) (rate(aurora_preprocessor_tpf_chunk_boundary_jump_ppm_bucket{quantile="p95"}[15m])))`, start, end)

	s.queryMetric(ctx, hop, "completed_target_pixels", fmt.Sprintf(`sum(increase(aurora_preprocessor_products_total{kind="target_pixel",status="success"}[%s]))`, window), start, end)
}

func (s *DAGAggregationService) aggregateTPFParquetHop(ctx context.Context, hop *entity.PreprocessingHop, start, end time.Time, window string) {
	s.queryMetric(ctx, hop, "silver_bytes_rate", `sum(rate(aurora_preprocessor_bytes_total{stage="silver"}[2m]))`, start, end)
	s.queryMetric(ctx, hop, "tpf_duration_p95", `histogram_quantile(0.95, sum by (le) (rate(aurora_preprocessor_processing_duration_seconds_bucket{kind="target_pixel"}[5m])))`, start, end)
	s.queryMetric(ctx, hop, "silver_bytes", fmt.Sprintf(`sum(increase(aurora_preprocessor_bytes_total{stage="silver",kind="target_pixel"}[%s]))`, window), start, end)
	s.queryMetric(ctx, hop, "completed_target_pixels", fmt.Sprintf(`sum(increase(aurora_preprocessor_products_total{kind="target_pixel",status="success"}[%s]))`, window), start, end)
}

func (s *DAGAggregationService) aggregateSilverHop(ctx context.Context, hop *entity.PreprocessingHop, start, end time.Time, window string) {
	s.queryMetric(ctx, hop, "throughput", `sum(rate(aurora_preprocessor_products_total{status="success"}[1m]))`, start, end)
	s.queryMetric(ctx, hop, "silver_bytes_rate", `sum(rate(aurora_preprocessor_bytes_total{stage="silver"}[2m]))`, start, end)
	s.queryMetric(ctx, hop, "lc_duration_p95", `histogram_quantile(0.95, sum by (le) (rate(aurora_preprocessor_processing_duration_seconds_bucket{kind="lightcurve"}[5m])))`, start, end)
	s.queryMetric(ctx, hop, "tpf_duration_p95", `histogram_quantile(0.95, sum by (le) (rate(aurora_preprocessor_processing_duration_seconds_bucket{kind="target_pixel"}[5m])))`, start, end)

	s.queryMetric(ctx, hop, "silver_bytes", fmt.Sprintf(`sum(increase(aurora_preprocessor_bytes_total{stage="silver"}[%s]))`, window), start, end)
	s.queryMetric(ctx, hop, "completed_lightcurves", fmt.Sprintf(`sum(increase(aurora_preprocessor_products_total{kind="lightcurve",status="success"}[%s]))`, window), start, end)
	s.queryMetric(ctx, hop, "completed_target_pixels", fmt.Sprintf(`sum(increase(aurora_preprocessor_products_total{kind="target_pixel",status="success"}[%s]))`, window), start, end)
	s.queryMetric(ctx, hop, "failed_products", fmt.Sprintf(`sum(increase(aurora_preprocessor_products_total{status="failed"}[%s]))`, window), start, end)
}

func (s *DAGAggregationService) aggregateCheckpointHop(ctx context.Context, hop *entity.PreprocessingHop, start, end time.Time, window string) {
	s.queryMetric(ctx, hop, "throughput", `sum(rate(aurora_preprocessor_products_total[1m]))`, start, end)
	s.queryMetric(ctx, hop, "errors", `sum(rate(aurora_preprocessor_products_total{status="failed"}[1m]))`, start, end)
	s.queryMetric(ctx, hop, "completed_products", fmt.Sprintf(`sum(increase(aurora_preprocessor_products_total{status="success"}[%s]))`, window), start, end)
	s.queryMetric(ctx, hop, "failed_products", fmt.Sprintf(`sum(increase(aurora_preprocessor_products_total{status="failed"}[%s]))`, window), start, end)
}

func (s *DAGAggregationService) aggregateLineageHop(ctx context.Context, hop *entity.PreprocessingHop, start, end time.Time, window string) {
	s.queryMetric(ctx, hop, "throughput", `sum(rate(aurora_preprocessor_products_total{status="success"}[1m]))`, start, end)
	s.queryMetric(ctx, hop, "completed_products", fmt.Sprintf(`sum(increase(aurora_preprocessor_products_total{status="success"}[%s]))`, window), start, end)
}

func (s *DAGAggregationService) aggregateEventHop(ctx context.Context, hop *entity.PreprocessingHop, start, end time.Time, window string) {
	s.queryMetric(ctx, hop, "throughput", `sum(rate(aurora_preprocessor_products_total{status="success"}[1m]))`, start, end)
	s.queryMetric(ctx, hop, "completed_products", fmt.Sprintf(`sum(increase(aurora_preprocessor_products_total{status="success"}[%s]))`, window), start, end)
}

func (s *DAGAggregationService) aggregateAckHop(ctx context.Context, hop *entity.PreprocessingHop, start, end time.Time, window string) {
	s.queryMetric(ctx, hop, "ack_rate", `sum(rate(aurora_preprocessor_products_total{status="success"}[1m]))`, start, end)
	s.queryMetric(ctx, hop, "ack_total", fmt.Sprintf(`sum(increase(aurora_preprocessor_products_total{status="success"}[%s]))`, window), start, end)
}

// ============================================================================
// DAG Visual Helpers — status inference, hop construction, metric/telemetry
// ============================================================================

const dagObservationWindow = 5 * time.Minute

// dagPipelineStatus infers overall pipeline activity status from metric observations.
func dagPipelineStatus(values map[string]float64, observed bool, now time.Time) string {
	if !observed {
		return "not_observed"
	}
	active := values["inflight"] > 0 || values["queue"] > 0 || values["throughput"] > 0
	if values["errors"] > 0 {
		if active {
			return "retry"
		}
		return "failed"
	}
	if active {
		return "running"
	}
	if values["last_success"] > 0 {
		age := now.Sub(time.Unix(int64(values["last_success"]), 0))
		if age >= 0 && age <= dagObservationWindow {
			return "completed"
		}
	}
	return "not_observed"
}

// dagHops constructs the full 8-step Pipeline DAG with real-time metrics from backend state.
func dagHops(values map[string]float64, observations map[string][]entity.MonitoringPoint, observedAt time.Time, details map[string]string, progress entity.PreprocessingProgress) []entity.PreprocessingHop {
	baseMetrics := make(map[string]float64, len(values))
	for key, value := range values {
		baseMetrics[key] = value
	}
	terminalCheckpoints := 0
	for _, point := range progress.CheckpointPoints {
		if point.Terminal {
			terminalCheckpoints++
		}
	}
	ackLagSeconds := 0.0
	if !progress.BronzeLastDeliveredAt.IsZero() && !progress.BronzeLastAckAt.IsZero() {
		ackLagSeconds = math.Max(0, progress.BronzeLastAckAt.Sub(progress.BronzeLastDeliveredAt).Seconds())
	}

	hops := []entity.PreprocessingHop{
		{
			ID:          "bronze",
			Label:       "Bronze FITS",
			Description: "Immutable source artifact",
			Contract:    "bronze/tess/<product>/sector=<sector>/tic=<tic>/",
			Input:       "NASA FITS",
			Output:      "Verified Bronze object",
			Metrics: map[string]float64{
				"total_files":        float64(progress.BronzeTotal),
				"lightcurve_files":   float64(progress.BronzeLightCurves),
				"target_pixel_files": float64(progress.BronzeTargetPixels),
				"pending_files":      float64(progress.BronzePending),
				"failed_files":       float64(progress.BronzeFailed),
				"bronze_bytes":       float64(progress.BronzeBytes),
				"inventory_observed": dagBoolToMetric(progress.BronzeObserved),
				"throughput":         values["throughput"],
			},
			Telemetry: dagMetricSeries(observations, "throughput"),
		},
		{
			ID:          "decode",
			Label:       "Decode & validate",
			Description: "Read FITS and validate product shape",
			Contract:    "product-kind validation",
			Input:       "Bronze FITS",
			Output:      "Validated samples",
			Metrics: dagMergeMetricValues(dagMetricValues(values,
				"lc_input_rate", "tpf_input_rate", "lc_quality_removed_rate", "tpf_quality_removed_rate",
				"lc_invalid_removed_rate", "tpf_invalid_removed_rate", "lc_nonfinite_removed_rate", "tpf_nonfinite_removed_rate",
				"lc_nonpositive_removed_rate", "tpf_nonpositive_removed_rate", "lc_input_total", "tpf_input_total",
				"lc_quality_removed_total", "tpf_quality_removed_total", "lc_nonfinite_removed_total", "tpf_nonfinite_removed_total",
				"lc_nonpositive_removed_total", "tpf_nonpositive_removed_total", "errors"), map[string]float64{
				"completed_lightcurves":   float64(progress.CompletedLightCurves),
				"completed_target_pixels": float64(progress.CompletedTargetPixels),
				"science_counts_observed": dagBoolToMetric(progress.ScienceCountsObserved),
				"lc_input_samples":        float64(progress.LCInputSamples),
				"lc_output_samples":       float64(progress.LCOutputSamples),
				"lc_quality_removed":      float64(progress.LCQualityRemoved),
				"lc_invalid_removed":      float64(progress.LCInvalidRemoved),
				"lc_nonfinite_removed":    float64(progress.LCNonfiniteRemoved),
				"lc_nonpositive_removed":  float64(progress.LCNonpositiveRemoved),
				"lc_outlier_removed":      float64(progress.LCOutlierRemoved),
				"tpf_input_samples":       float64(progress.TPFInputSamples),
				"tpf_output_samples":      float64(progress.TPFOutputSamples),
				"tpf_quality_removed":     float64(progress.TPFQualityRemoved),
				"tpf_invalid_removed":     float64(progress.TPFInvalidRemoved),
				"tpf_nonfinite_removed":   float64(progress.TPFNonfiniteRemoved),
				"tpf_nonpositive_removed": float64(progress.TPFNonpositiveRemoved),
				"failed_products":         float64(progress.CheckpointFailed),
			}),
			Telemetry: dagMetricSeries(observations,
				"lc_input_rate", "tpf_input_rate", "lc_quality_removed_rate", "tpf_quality_removed_rate",
				"lc_invalid_removed_rate", "tpf_invalid_removed_rate", "lc_nonfinite_removed_rate", "tpf_nonfinite_removed_rate",
				"lc_nonpositive_removed_rate", "tpf_nonpositive_removed_rate"),
		},
		{
			ID:          "transform",
			Label:       "Scientific transform",
			Description: "Clean, normalize and derive masks",
			Contract:    "lc-preprocess-v1 / tpf-preprocess-v2-chunked",
			Input:       "Validated samples",
			Output:      "Silver rows",
			Metrics: dagMergeMetricValues(dagMetricValues(values,
				"lc_output_rate", "tpf_output_rate", "lc_outlier_removed_rate", "lc_sigma_clip_3_4_rate", "lc_sigma_clip_4_5_rate", "lc_sigma_clip_ge_5_rate",
				"tpf_finite_pixel_fraction", "lc_scatter_before_p50", "lc_scatter_before_p95", "lc_scatter_after_p50", "lc_scatter_after_p95",
				"lc_sigma_clip_fraction_p95", "tpf_finite_pixel_fraction_p05", "tpf_pixel_input_rate", "tpf_pixel_retained_rate",
				"tpf_pixel_nonfinite_rate", "tpf_pixel_invalid_reference_rate", "tpf_scatter_p50", "tpf_scatter_p95",
				"tpf_reference_drift_p95", "tpf_boundary_jump_p95", "lc_duration_p95", "tpf_duration_p95", "throughput"), map[string]float64{
				"completed_lightcurves":            float64(progress.CompletedLightCurves),
				"completed_target_pixels":          float64(progress.CompletedTargetPixels),
				"lc_preclip_samples":               float64(progress.LCOutputSamples + progress.LCOutlierRemoved),
				"lc_retained_samples":              float64(progress.LCOutputSamples),
				"lc_outlier_removed":               float64(progress.LCOutlierRemoved),
				"lc_sigma_clip_3_4_removed":        float64(progress.LCSigmaClip3To4),
				"lc_sigma_clip_4_5_removed":        float64(progress.LCSigmaClip4To5),
				"lc_sigma_clip_ge_5_removed":       float64(progress.LCSigmaClipGE5),
				"lc_transform_products":            float64(progress.LCTransformProducts),
				"lc_scatter_products":              float64(progress.LCScatterProducts),
				"lc_scatter_before_mean_durable":   progress.LCScatterBeforeMean,
				"lc_scatter_before_p50_durable":    progress.LCScatterBeforeP50,
				"lc_scatter_before_p95_durable":    progress.LCScatterBeforeP95,
				"lc_scatter_after_mean_durable":    progress.LCScatterAfterMean,
				"lc_scatter_after_p50_durable":     progress.LCScatterAfterP50,
				"lc_scatter_after_p95_durable":     progress.LCScatterAfterP95,
				"lc_outlier_fraction_p50_durable":  progress.LCOutlierFractionP50,
				"lc_outlier_fraction_p95_durable":  progress.LCOutlierFractionP95,
				"tpf_finite_products":              float64(progress.TPFFiniteProducts),
				"tpf_finite_fraction_mean_durable": progress.TPFFiniteFractionMean,
				"tpf_finite_fraction_p05_durable":  progress.TPFFiniteFractionP05,
				"tpf_finite_fraction_p50_durable":  progress.TPFFiniteFractionP50,
			}),
			Telemetry: dagMetricSeries(observations,
				"lc_output_rate", "tpf_output_rate", "lc_outlier_removed_rate", "lc_sigma_clip_3_4_rate", "lc_sigma_clip_4_5_rate", "lc_sigma_clip_ge_5_rate",
				"tpf_finite_pixel_fraction", "lc_scatter_before_p50", "lc_scatter_before_p95", "lc_scatter_after_p50", "lc_scatter_after_p95",
				"lc_sigma_clip_fraction_p95", "tpf_finite_pixel_fraction_p05", "tpf_pixel_input_rate", "tpf_pixel_retained_rate",
				"tpf_pixel_nonfinite_rate", "tpf_pixel_invalid_reference_rate", "tpf_scatter_p50", "tpf_scatter_p95",
				"tpf_reference_drift_p95", "tpf_boundary_jump_p95", "lc_duration_p95", "tpf_duration_p95"),
		},
		{
			ID:          "silver",
			Label:       "Silver Parquet",
			Description: "Write, upload and verify Silver",
			Contract:    "silver/tess/<product>/processor=<version>/",
			Input:       "Silver rows",
			Output:      "Verified Parquet",
			Metrics: map[string]float64{
				"silver_objects":       float64(progress.SilverTotal),
				"silver_lightcurves":   float64(progress.SilverLightCurves),
				"silver_target_pixels": float64(progress.SilverTargetPixels),
				"silver_bytes":         float64(progress.SilverBytes),
				"inventory_observed":   dagBoolToMetric(progress.FootprintObserved),
				"throughput":           values["throughput"],
				"bronze_bytes_rate":    values["bronze_bytes_rate"],
				"silver_bytes_rate":    values["silver_bytes_rate"],
			},
			Telemetry: dagMetricSeries(observations, "throughput", "bronze_bytes_rate", "silver_bytes_rate"),
		},
		{
			ID:          "checkpoint",
			Label:       "Checkpoint",
			Description: "Persist crash-safe processing state",
			Contract:    "checkpoints/preprocessing/objects/<id>.json",
			Input:       "Silver verification",
			Output:      "Completed checkpoint",
			Metrics: map[string]float64{
				"checkpoint_total":     float64(progress.CheckpointTotal),
				"checkpoint_completed": float64(progress.CheckpointCompleted),
				"checkpoint_pending":   float64(progress.CheckpointPending),
				"checkpoint_failed":    float64(progress.CheckpointFailed),
				"throughput":           values["throughput"],
			},
			Telemetry: dagMetricSeries(observations, "throughput"),
		},
		{
			ID:          "lineage",
			Label:       "Lineage & stored footprint",
			Description: "Commit source → Bronze → Silver identity and measure persisted MinIO tiers",
			Contract:    "lineage/v1/<lineage-id>.json",
			Input:       "Checkpoint + checksums",
			Output:      "Committed lineage",
			Metrics: map[string]float64{
				"bronze_bytes":       float64(progress.BronzeBytes),
				"bronze_objects":     float64(progress.BronzeTotal),
				"silver_bytes":       float64(progress.SilverBytes),
				"silver_objects":     float64(progress.SilverTotal),
				"inventory_observed": dagBoolToMetric(progress.FootprintObserved),
			},
		},
		{
			ID:          "event",
			Label:       "Silver event",
			Description: "Publish downstream-ready event",
			Contract:    "aurora.v1.silver.<product>.ready",
			Input:       "Committed lineage",
			Output:      "Published event",
			Metrics: map[string]float64{
				"stream_observed":        dagBoolToMetric(progress.SilverEventObserved),
				"eligible_artifacts":     float64(progress.SilverTotal),
				"eligible_lightcurves":   float64(progress.SilverLightCurves),
				"eligible_target_pixels": float64(progress.SilverTargetPixels),
				"event_emissions":        float64(progress.SilverEventMessages),
				"event_bytes":            float64(progress.SilverEventBytes),
				"event_consumers":        float64(progress.SilverEventConsumers),
				"lightcurve_emissions":   float64(progress.SilverEventLightCurves),
				"target_pixel_emissions": float64(progress.SilverEventTargetPixels),
				"event_first_timestamp":  dagTimeToMetric(progress.SilverEventFirstAt),
				"event_last_timestamp":   dagTimeToMetric(progress.SilverEventLastAt),
				"event_replay_emissions": float64(max(int64(0), progress.SilverEventMessages-int64(progress.SilverTotal))),
			},
		},
		{
			ID:          "ack",
			Label:       "Bronze ACK",
			Description: "Acknowledge only after durable output",
			Contract:    "NATS durable consumer ACK",
			Input:       "Published event",
			Output:      "Bronze message ACKed",
			Metrics: map[string]float64{
				"consumer_observed":             dagBoolToMetric(progress.BronzeConsumerObserved),
				"stream_messages":               float64(progress.BronzeStreamMessages),
				"stream_bytes":                  float64(progress.BronzeStreamBytes),
				"delivery_attempts":             float64(progress.BronzeDeliveredConsumer),
				"delivered_stream_positions":    float64(progress.BronzeDeliveredStream),
				"acknowledged_deliveries":       float64(progress.BronzeAckFloorConsumer),
				"acknowledged_stream_positions": float64(progress.BronzeAckFloorStream),
				"historical_redeliveries":       float64(max(int64(0), progress.BronzeDeliveredConsumer-progress.BronzeDeliveredStream)),
				"ack_pending":                   float64(progress.BronzeConsumerAckPending),
				"pending":                       float64(progress.BronzeConsumerPending),
				"current_redelivered":           float64(progress.BronzeCurrentRedelivered),
				"waiting_fetches":               float64(progress.BronzeConsumerWaiting),
				"last_delivered_timestamp":      dagTimeToMetric(progress.BronzeLastDeliveredAt),
				"last_ack_timestamp":            dagTimeToMetric(progress.BronzeLastAckAt),
				"last_delivery_to_ack_seconds":  ackLagSeconds,
				"completed_checkpoints":         float64(progress.CheckpointCompleted),
				"terminal_checkpoints":          float64(terminalCheckpoints),
			},
		},
	}
	baseHops := make(map[string]entity.PreprocessingHop, len(hops))
	for _, hop := range hops {
		baseHops[hop.ID] = hop
	}
	deriveHop := func(sourceID, id, label, description, contract, input, output string) entity.PreprocessingHop {
		hop := baseHops[sourceID]
		hop.ID = id
		hop.Label = label
		hop.Description = description
		hop.Contract = contract
		hop.Input = input
		hop.Output = output
		return hop
	}
	hops = []entity.PreprocessingHop{
		deriveHop("bronze", "bronze", "Bronze verify & fetch", "Verify object identity, size and checksum before local staging", "bronze/tess/<product>/sector=<sector>/tic=<tic>/", "NASA MAST FITS", "Verified local FITS"),
		deriveHop("decode", "route", "Product router & FITS reader", "Route each verified product to the full LC decoder or bounded-memory TPF chunk reader", "fits-product-router-v1", "Verified local FITS", "Typed LC stream or TPF chunks"),
		deriveHop("decode", "lc-quality", "LC cadence quality control", "Apply quality bitmask, finite-value checks, time validity and cadence deduplication", "quality-flag-bitmask-v1/lc", "Decoded Light Curve", "Quality-valid LC cadences"),
		deriveHop("transform", "lc-transform", "LC normalization & sigma clip", "Normalize relative flux by its median and optionally remove configured sigma outliers", "lc-preprocess-v1", "Quality-valid LC cadences", "Normalized LC samples"),
		deriveHop("silver", "lc-parquet", "LC Parquet encode", "Encode the complete normalized Light Curve as a checksummed ZSTD Parquet artifact", "silver-lightcurve-v1", "Normalized LC samples", "Local LC Parquet"),
		deriveHop("decode", "tpf-quality", "TPF chunk decode & cadence QC", "Read bounded cadence chunks and apply quality, finite-time and time-validity filters", "quality-flag-bitmask-v1/tpf-chunk", "Target Pixel FITS", "Quality-valid TPF chunks"),
		deriveHop("transform", "tpf-transform", "TPF temporal pixel normalization", "Normalize each bounded Target Pixel chunk against its temporal pixel reference", "tpf-preprocess-v2-chunked", "Quality-valid TPF chunk", "Normalized TPF chunk"),
		deriveHop("silver", "tpf-parquet", "TPF row-group append & finalize", "Append each normalized chunk as a Parquet row group, then finalize the complete artifact", "silver-target-pixel-v1/chunked", "Normalized TPF chunks", "Local TPF Parquet"),
		deriveHop("silver", "silver", "Silver upload & integrity verify", "Upload the finalized LC or TPF Parquet object and verify durable size, checksum and metadata", "silver/tess/<product>/processor=<version>/", "Finalized local Parquet", "Verified Silver object"),
		baseHops["checkpoint"], baseHops["lineage"], baseHops["event"], baseHops["ack"],
	}
	statuses := dagHopStatuses(values, progress)
	for i := range hops {
		hops[i].Status = statuses[hops[i].ID]
		hops[i].ObservedAt = observedAt
		hops[i].Details = dagHopDetails(hops[i].ID, details)
		if hops[i].Metrics == nil {
			hops[i].Metrics = baseMetrics
		}
		if hops[i].ID == "lc-transform" {
			hops[i].ScatterPoints = append([]entity.PreprocessingScatterPoint(nil), progress.LCScatterPoints...)
		}
		if hops[i].ID == "tpf-transform" {
			hops[i].TPFTransformPoints = append([]entity.PreprocessingTPFTransformPoint(nil), progress.TPFTransformPoints...)
		}
		if hops[i].ID == "silver" {
			hops[i].MaterializationPoints = append([]entity.PreprocessingMaterializationPoint(nil), progress.MaterializationPoints...)
			hops[i].SilverFailures = append([]entity.PreprocessingSilverFailure(nil), progress.SilverFailures...)
		}
		if hops[i].ID == "checkpoint" {
			hops[i].CheckpointPoints = append([]entity.PreprocessingCheckpointPoint(nil), progress.CheckpointPoints...)
		}
		if hops[i].ID == "lineage" {
			hops[i].MaterializationPoints = append([]entity.PreprocessingMaterializationPoint(nil), progress.MaterializationPoints...)
		}
		if hops[i].ID == "lc-parquet" || hops[i].ID == "tpf-parquet" {
			kind := "lightcurve"
			if hops[i].ID == "tpf-parquet" {
				kind = "target_pixel"
			}
			for _, point := range progress.MaterializationPoints {
				if point.ProductKind == kind {
					hops[i].MaterializationPoints = append(hops[i].MaterializationPoints, point)
				}
			}
			for _, failure := range progress.EncodeFailures {
				normalizedKind := strings.ToLower(strings.ReplaceAll(failure.ProductKind, "-", "_"))
				if normalizedKind == kind || (kind == "lightcurve" && normalizedKind == "light_curve") {
					hops[i].EncodeFailures = append(hops[i].EncodeFailures, failure)
				}
			}
		}
	}
	return hops
}

func dagMetricValues(values map[string]float64, keys ...string) map[string]float64 {
	result := make(map[string]float64, len(keys))
	for _, key := range keys {
		if value, ok := values[key]; ok {
			result[key] = value
		}
	}
	return result
}

func dagMergeMetricValues(target map[string]float64, source map[string]float64) map[string]float64 {
	for key, value := range source {
		target[key] = value
	}
	return target
}

func dagMetricSeries(observations map[string][]entity.MonitoringPoint, keys ...string) map[string][]entity.MonitoringPoint {
	result := make(map[string][]entity.MonitoringPoint, len(keys))
	for _, key := range keys {
		if points := observations[key]; len(points) > 0 {
			result[key] = points
		}
	}
	return result
}

func dagHopStatuses(values map[string]float64, progress entity.PreprocessingProgress) map[string]string {
	statuses := map[string]string{
		"bronze": "not_observed", "route": "not_observed",
		"lc-quality": "not_observed", "lc-transform": "not_observed", "lc-parquet": "not_observed",
		"tpf-quality": "not_observed", "tpf-transform": "not_observed", "tpf-parquet": "not_observed", "silver": "not_observed",
		"checkpoint": "not_observed", "lineage": "not_observed", "event": "not_observed", "ack": "not_observed",
	}
	if progress.BronzeObserved && progress.BronzeTotal > 0 {
		statuses["bronze"] = dagObservedComponentStatus(values, true)
		statuses["route"] = dagObservedComponentStatus(values, true)
	}
	lcObserved := progress.CompletedLightCurves > 0 || progress.SilverLightCurves > 0 || values["lc_input_rate"] > 0 || values["lc_output_rate"] > 0
	tpfObserved := progress.CompletedTargetPixels > 0 || progress.SilverTargetPixels > 0 || values["tpf_input_rate"] > 0 || values["tpf_output_rate"] > 0
	for _, id := range []string{"lc-quality", "lc-transform", "lc-parquet"} {
		statuses[id] = dagObservedComponentStatus(values, lcObserved)
	}
	for _, id := range []string{"tpf-quality", "tpf-transform", "tpf-parquet"} {
		statuses[id] = dagObservedComponentStatus(values, tpfObserved)
	}
	if progress.FootprintObserved && progress.SilverTotal > 0 {
		statuses["silver"] = dagObservedComponentStatus(values, true)
	}
	if progress.CheckpointTotal > 0 && progress.CheckpointPending == 0 {
		statuses["checkpoint"] = "completed"
	} else if progress.CheckpointPending > 0 && values["inflight"] > 0 {
		statuses["checkpoint"] = "running"
	}
	lineageObserved := progress.CheckpointCompleted > 0 && progress.SilverTotal > 0 && len(progress.MaterializationPoints) == progress.SilverTotal
	if lineageObserved {
		for _, point := range progress.MaterializationPoints {
			if !point.LineageBound {
				lineageObserved = false
				break
			}
		}
	}
	statuses["lineage"] = dagObservedComponentStatus(values, lineageObserved)
	eventObserved := progress.SilverEventObserved && progress.SilverEventMessages >= int64(progress.SilverTotal) && progress.SilverTotal > 0
	statuses["event"] = dagObservedComponentStatus(values, eventObserved)
	ackObserved := progress.BronzeConsumerObserved && progress.BronzeAckFloorStream > 0
	statuses["ack"] = dagObservedComponentStatus(values, ackObserved)
	return statuses
}

func dagObservedComponentStatus(values map[string]float64, observed bool) string {
	if !observed {
		return "not_observed"
	}
	if values["errors"] > 0 {
		return "retry"
	}
	if values["inflight"] > 0 || values["queue"] > 0 || values["throughput"] > 0 {
		return "running"
	}
	return "completed"
}

func dagBoolToMetric(value bool) float64 {
	if value {
		return 1
	}
	return 0
}

func dagTimeToMetric(value time.Time) float64 {
	if value.IsZero() {
		return 0
	}
	return float64(value.Unix())
}

// dagHopDetails filters checkpoint detail fields relevant to each pipeline hop.
func dagHopDetails(id string, checkpoint map[string]string) map[string]string {
	details := make(map[string]string)
	for key, value := range checkpoint {
		if strings.TrimSpace(value) == "" {
			continue
		}
		details[key] = value
	}
	if len(details) == 0 {
		return details
	}
	keysByHop := map[string][]string{
		"bronze":     {"source_product_id", "product_kind", "bronze_bucket", "bronze_object_key", "bronze_sha256"},
		"decode":     {"product_kind", "bronze_object_key", "attempts"},
		"transform":  {"product_kind", "processor_version", "attempts"},
		"silver":     {"silver_bucket", "silver_object_key", "silver_sha256", "silver_size_bytes", "silver_schema_version"},
		"checkpoint": {"checkpoint_id", "checkpoint_key", "state", "attempts", "terminal", "updated_at", "last_error"},
		"lineage":    {"source_product_id", "processor_version", "checkpoint_id"},
		"event":      {"silver_object_key", "silver_schema_version"},
		"ack":        {"source_product_id", "state"},
	}
	filtered := make(map[string]string)
	for _, key := range keysByHop[id] {
		if value, ok := details[key]; ok {
			filtered[key] = value
		}
	}
	return filtered
}
