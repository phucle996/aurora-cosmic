package service

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"go-api/internal/domain/entity"
	"go-api/internal/domain/repo"
	domainService "go-api/internal/domain/service"

	"github.com/google/uuid"
)

const preprocessingObservationWindow = 5 * time.Minute

type preprocessingMetric struct {
	key   string
	query string
}

var preprocessingMetrics = []preprocessingMetric{
	{key: "inflight", query: "aurora_preprocessor_inflight_workers"},
	{key: "queue", query: "aurora_preprocessor_queue_depth"},
	{key: "throughput", query: "sum(rate(aurora_preprocessor_products_total{status=\"success\"}[2m]))"},
	{key: "errors", query: "sum(rate(aurora_preprocessor_errors_total[2m]))"},
	{key: "last_success", query: "max(aurora_preprocessor_last_success_timestamp_seconds)"},
}

type PreprocessingService struct {
	prometheus repo.PrometheusQuerier
	dispatcher repo.WorkflowDispatcher
	publisher  repo.EventPublisher
}

func NewPreprocessingService(prometheus repo.PrometheusQuerier, dispatchers ...repo.WorkflowDispatcher) domainService.Preprocessing {
	var dispatcher repo.WorkflowDispatcher
	if len(dispatchers) > 0 {
		dispatcher = dispatchers[0]
	}
	return &PreprocessingService{prometheus: prometheus, dispatcher: dispatcher}
}

func NewPreprocessingServiceWithEvents(prometheus repo.PrometheusQuerier, dispatcher repo.WorkflowDispatcher, publisher repo.EventPublisher) domainService.Preprocessing {
	return &PreprocessingService{prometheus: prometheus, dispatcher: dispatcher, publisher: publisher}
}

func (s *PreprocessingService) Start(ctx context.Context, request entity.PreprocessingStartRequest) (*entity.PreprocessingControlJob, error) {
	if s.dispatcher == nil {
		return nil, fmt.Errorf("preprocessing control is unavailable")
	}
	request.Mode = strings.ToLower(strings.TrimSpace(request.Mode))
	if request.Mode == "" {
		request.Mode = "stream"
	}
	if request.Mode != "stream" && request.Mode != "batch" {
		return nil, fmt.Errorf("preprocessing mode must be stream or batch")
	}
	job := &entity.PreprocessingControlJob{JobID: "preprocess-job-" + uuid.NewString()[:8], Status: "accepted", Mode: request.Mode, IngestRunID: strings.TrimSpace(request.IngestRunID), Prefix: strings.TrimSpace(request.Prefix), StartedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC()}
	command, err := json.Marshal(struct {
		Action      string `json:"action"`
		JobID       string `json:"job_id"`
		Mode        string `json:"mode"`
		IngestRunID string `json:"ingest_run_id,omitempty"`
		Prefix      string `json:"prefix,omitempty"`
	}{Action: "start", JobID: job.JobID, Mode: job.Mode, IngestRunID: job.IngestRunID, Prefix: job.Prefix})
	if err != nil {
		return nil, fmt.Errorf("encode preprocessing command: %w", err)
	}
	if err := s.dispatcher.Dispatch(ctx, "preprocessing_start", command); err != nil {
		return nil, fmt.Errorf("dispatch preprocessing command: %w", err)
	}
	job.Status = "running"
	if s.publisher != nil {
		payload, _ := json.Marshal(job)
		_ = s.publisher.Publish(ctx, entity.WorkflowEvent{Type: "workflow", Workflow: "preprocessing", Status: job.Status, JobID: job.JobID, OccurredAt: job.UpdatedAt, Payload: payload})
	}
	return job, nil
}

func (s *PreprocessingService) Query(ctx context.Context) (*entity.PreprocessingGraph, error) {
	if s.prometheus == nil {
		return nil, fmt.Errorf("Prometheus preprocessing observation is unavailable")
	}
	end := time.Now().UTC()
	start := end.Add(-preprocessingObservationWindow)
	observations := make(map[string][]entity.MonitoringPoint, len(preprocessingMetrics))
	var mu sync.Mutex
	var wg sync.WaitGroup
	var queryErrors int
	for _, metric := range preprocessingMetrics {
		metric := metric
		wg.Add(1)
		go func() {
			defer wg.Done()
			points, err := s.prometheus.QueryRange(ctx, metric.query, start, end, 30*time.Second)
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				queryErrors++
				return
			}
			observations[metric.key] = points
		}()
	}
	wg.Wait()
	if queryErrors == len(preprocessingMetrics) {
		return nil, fmt.Errorf("all Prometheus preprocessing queries failed")
	}

	values := make(map[string]float64, len(observations))
	observed := false
	for key, points := range observations {
		if len(points) == 0 {
			continue
		}
		observed = true
		values[key] = lastPoint(points).Value
	}
	status := preprocessingStatus(values, observed, end)
	hops := preprocessingHops(status, values, end)
	edges := make([]entity.PreprocessingEdge, 0, len(hops)-1)
	for i := 0; i < len(hops)-1; i++ {
		edges = append(edges, entity.PreprocessingEdge{ID: fmt.Sprintf("edge-%d", i), Source: hops[i].ID, Target: hops[i+1].ID, Status: status, ObservedAt: end})
	}
	return &entity.PreprocessingGraph{Source: "prometheus", ObservationScope: "preprocessor_service", Status: status, ObservedAt: end, Hops: hops, Edges: edges}, nil
}

func lastPoint(points []entity.MonitoringPoint) entity.MonitoringPoint {
	sort.Slice(points, func(i, j int) bool { return points[i].Timestamp < points[j].Timestamp })
	return points[len(points)-1]
}

func preprocessingStatus(values map[string]float64, observed bool, now time.Time) string {
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
		if age >= 0 && age <= preprocessingObservationWindow {
			return "completed"
		}
	}
	return "not_observed"
}

func preprocessingHops(status string, values map[string]float64, observedAt time.Time) []entity.PreprocessingHop {
	metrics := make(map[string]float64, len(values))
	for key, value := range values {
		metrics[key] = value
	}
	hops := []entity.PreprocessingHop{
		{ID: "bronze", Label: "Bronze FITS", Description: "Immutable source artifact", Contract: "bronze/tess/<product>/sector=<sector>/tic=<tic>/", Input: "NASA FITS", Output: "Verified Bronze object"},
		{ID: "decode", Label: "Decode & validate", Description: "Read FITS and validate product shape", Contract: "product-kind validation", Input: "Bronze FITS", Output: "Validated samples"},
		{ID: "transform", Label: "Scientific transform", Description: "Clean, normalize and derive masks", Contract: "lc-preprocess-v1 / tpf-preprocess-v1 / ffi-preprocess-v1", Input: "Validated samples", Output: "Silver rows"},
		{ID: "silver", Label: "Silver Parquet", Description: "Write, upload and verify Silver", Contract: "silver/tess/<product>/processor=<version>/", Input: "Silver rows", Output: "Verified Parquet"},
		{ID: "checkpoint", Label: "Checkpoint", Description: "Persist crash-safe processing state", Contract: "checkpoints/preprocessing/objects/<id>.json", Input: "Silver verification", Output: "Completed checkpoint"},
		{ID: "lineage", Label: "Lineage commit", Description: "Commit source → Bronze → Silver identity", Contract: "lineage/v1/<lineage-id>.json", Input: "Checkpoint + checksums", Output: "Committed lineage"},
		{ID: "event", Label: "Silver event", Description: "Publish downstream-ready event", Contract: "aurora.v1.silver.<product>.ready", Input: "Committed lineage", Output: "Published event"},
		{ID: "ack", Label: "Bronze ACK", Description: "Acknowledge only after durable output", Contract: "NATS durable consumer ACK", Input: "Published event", Output: "Bronze message ACKed"},
	}
	for i := range hops {
		hops[i].Status, hops[i].ObservedAt, hops[i].Metrics = status, observedAt, metrics
	}
	return hops
}
