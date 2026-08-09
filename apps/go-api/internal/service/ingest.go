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
)

type IngestService struct {
	objects    repo.ObjectRepository
	prometheus repo.PrometheusQuerier
	bucket     string
	controller repo.IngestController
	publisher  repo.EventPublisher
	runtimeMu  sync.RWMutex
	runtimeJob *entity.IngestControlJob
	runtime    *entity.IngestStatus
}

type ingestionCheckpoint struct {
	RunID        string                      `json:"run_id"`
	Status       string                      `json:"status"`
	ManifestPath string                      `json:"manifest_path"`
	StartedAt    time.Time                   `json:"started_at"`
	UpdatedAt    time.Time                   `json:"updated_at"`
	Products     map[string]ingestionProduct `json:"products"`
}

type ingestionProduct struct {
	ProductKind       string    `json:"product_kind"`
	ObjectKey         string    `json:"object_key"`
	ExpectedSizeBytes int64     `json:"expected_size_bytes"`
	SizeBytes         int64     `json:"size_bytes"`
	State             string    `json:"state"`
	Attempts          int       `json:"attempts"`
	LastError         string    `json:"last_error,omitempty"`
	UpdatedAt         time.Time `json:"updated_at"`
}

func NewIngestService(objects repo.ObjectRepository, prometheus repo.PrometheusQuerier, bucket string, controllers ...repo.IngestController) domainService.Ingest {
	var controller repo.IngestController
	if len(controllers) > 0 {
		controller = controllers[0]
	}
	return &IngestService{objects: objects, prometheus: prometheus, bucket: bucket, controller: controller}
}

func NewIngestServiceWithEvents(objects repo.ObjectRepository, prometheus repo.PrometheusQuerier, bucket string, controller repo.IngestController, publisher repo.EventPublisher) domainService.Ingest {
	return &IngestService{objects: objects, prometheus: prometheus, bucket: bucket, controller: controller, publisher: publisher}
}

func (s *IngestService) Start(ctx context.Context, request entity.IngestStartRequest) (*entity.IngestControlJob, error) {
	if s.controller == nil {
		return nil, fmt.Errorf("ingester control is unavailable")
	}
	job, err := s.controller.Start(ctx, request)
	if err != nil {
		return nil, err
	}
	if s.publisher != nil {
		payload, _ := json.Marshal(job)
		_ = s.publisher.Publish(ctx, entity.WorkflowEvent{Type: "workflow", Workflow: "ingest", Status: job.Status, JobID: job.JobID, OccurredAt: job.UpdatedAt, Payload: payload})
	}
	s.runtimeMu.Lock()
	s.runtimeJob = job
	s.runtime = &entity.IngestStatus{Observed: true, Source: "api-runtime", ControlJobID: job.JobID, Status: strings.ToLower(job.Status), ManifestPath: job.ManifestPath, StartedAt: job.StartedAt, UpdatedAt: job.UpdatedAt, ObservedAt: time.Now().UTC(), Products: []entity.IngestProduct{}}
	s.runtimeMu.Unlock()
	return job, nil
}

func (s *IngestService) Cancel(ctx context.Context, jobID string) (*entity.IngestControlJob, error) {
	if s.controller == nil {
		return nil, fmt.Errorf("ingester control is unavailable")
	}
	job, err := s.controller.Cancel(ctx, jobID)
	if err != nil {
		return nil, err
	}
	if s.publisher != nil {
		payload, _ := json.Marshal(job)
		_ = s.publisher.Publish(ctx, entity.WorkflowEvent{Type: "workflow", Workflow: "ingest", Status: job.Status, JobID: job.JobID, OccurredAt: job.UpdatedAt, Payload: payload})
	}
	s.runtimeMu.Lock()
	s.runtimeJob = job
	if s.runtime != nil {
		s.runtime.Status = strings.ToLower(job.Status)
		s.runtime.UpdatedAt = job.UpdatedAt
		s.runtime.ObservedAt = time.Now().UTC()
	}
	s.runtimeMu.Unlock()
	return job, nil
}

func (s *IngestService) Status(ctx context.Context) (*entity.IngestStatus, error) {
	if s.objects == nil {
		return nil, fmt.Errorf("MinIO ingestion checkpoint is unavailable")
	}
	var controlJob *entity.IngestControlJob
	if runtimeController, ok := s.controller.(repo.IngestRuntimeController); ok {
		if current, currentErr := runtimeController.Current(ctx); currentErr == nil && current != nil && current.Status != "not_observed" {
			controlJob = current
			s.runtimeMu.Lock()
			s.runtimeJob = current
			if s.runtime == nil || current.StartedAt.After(s.runtime.StartedAt) {
				s.runtime = &entity.IngestStatus{Observed: true, Source: "ingester-control", ControlJobID: current.JobID, Status: strings.ToLower(current.Status), Error: current.Error, ManifestPath: current.ManifestPath, StartedAt: current.StartedAt, UpdatedAt: current.UpdatedAt, ObservedAt: time.Now().UTC(), Products: []entity.IngestProduct{}}
			} else {
				s.runtime.Status = strings.ToLower(current.Status)
				s.runtime.Error = current.Error
				s.runtime.UpdatedAt = current.UpdatedAt
				s.runtime.ObservedAt = time.Now().UTC()
			}
			s.runtimeMu.Unlock()
		}
	}
	data, err := s.objects.GetObject(ctx, "checkpoints/ingestion/current.json")
	if err != nil {
		s.runtimeMu.RLock()
		if s.runtime != nil {
			cached := *s.runtime
			cached.Products = append([]entity.IngestProduct(nil), s.runtime.Products...)
			s.runtimeMu.RUnlock()
			return &cached, nil
		}
		s.runtimeMu.RUnlock()
		return &entity.IngestStatus{Observed: false, Source: "minio-checkpoint", Status: "not_observed", ObservedAt: time.Now().UTC()}, nil
	}
	var pointer struct {
		ActiveRunID string `json:"active_run_id"`
	}
	if err := json.Unmarshal(data, &pointer); err != nil || pointer.ActiveRunID == "" {
		return nil, fmt.Errorf("decode ingestion checkpoint pointer: %w", err)
	}
	data, err = s.objects.GetObject(ctx, "checkpoints/ingestion/runs/"+pointer.ActiveRunID+".json")
	if err != nil {
		return nil, fmt.Errorf("load ingestion run %s: %w", pointer.ActiveRunID, err)
	}
	var checkpoint ingestionCheckpoint
	if err := json.Unmarshal(data, &checkpoint); err != nil {
		return nil, fmt.Errorf("decode ingestion run %s: %w", pointer.ActiveRunID, err)
	}
	status := &entity.IngestStatus{Observed: true, Source: "minio-checkpoint", RunID: checkpoint.RunID, Status: strings.ToLower(checkpoint.Status), ManifestPath: checkpoint.ManifestPath, StartedAt: checkpoint.StartedAt, UpdatedAt: checkpoint.UpdatedAt, ObservedAt: time.Now().UTC(), Products: make([]entity.IngestProduct, 0, len(checkpoint.Products))}
	if controlJob != nil {
		status.ControlJobID = controlJob.JobID
	}
	usingRuntimeState := false
	s.runtimeMu.RLock()
	if s.runtime != nil && controlJob != nil && s.runtime.StartedAt.After(checkpoint.UpdatedAt) {
		usingRuntimeState = true
		status = &entity.IngestStatus{Observed: true, Source: "api-runtime", ControlJobID: s.runtime.ControlJobID, Status: s.runtime.Status, Error: s.runtime.Error, ManifestPath: s.runtime.ManifestPath, StartedAt: s.runtime.StartedAt, UpdatedAt: s.runtime.UpdatedAt, ObservedAt: time.Now().UTC(), Products: []entity.IngestProduct{}}
	}
	s.runtimeMu.RUnlock()
	if !usingRuntimeState {
		for id, product := range checkpoint.Products {
			status.TotalProducts++
			status.ExpectedBytes += product.ExpectedSizeBytes
			status.CompletedBytes += product.SizeBytes
			switch strings.ToUpper(product.State) {
			case "STORED", "PUBLISHED":
				status.CompletedProducts++
			case "DOWNLOADING":
				status.Downloading++
			case "FAILED":
				status.FailedProducts++
			}
			status.Products = append(status.Products, entity.IngestProduct{ID: id, Kind: string(product.ProductKind), ObjectKey: product.ObjectKey, State: strings.ToLower(product.State), SizeBytes: product.SizeBytes, Expected: product.ExpectedSizeBytes, Attempts: product.Attempts, LastError: product.LastError, UpdatedAt: product.UpdatedAt})
		}
		sort.Slice(status.Products, func(i, j int) bool { return status.Products[i].UpdatedAt.After(status.Products[j].UpdatedAt) })
	}
	// The control plane is authoritative for lifecycle state. A cancellation
	// can leave the durable checkpoint in RUNNING until the worker has flushed
	// its final snapshot; exposing that stale checkpoint state keeps the UI on
	// the Cancel button after the control job is already canceled.
	if controlJob != nil {
		status.ControlJobID = controlJob.JobID
		status.Status = strings.ToLower(controlJob.Status)
		status.Error = controlJob.Error
		if controlJob.UpdatedAt.After(status.UpdatedAt) {
			status.UpdatedAt = controlJob.UpdatedAt
		}
	}
	if s.prometheus != nil && status.Status == "running" {
		end := time.Now().UTC()
		start := end.Add(-5 * time.Minute)
		queries := map[string]string{
			"products": "sum(rate(aurora_ingester_products_total{status=\"success\"}[2m]))",
			"bytes":    "rate(aurora_ingester_bytes_processed_total[2m])",
			"queue":    "aurora_ingester_queue_depth",
			"inflight": "aurora_ingester_inflight_products",
		}
		var wg sync.WaitGroup
		var mu sync.Mutex
		values := make(map[string]float64, len(queries))
		for key, query := range queries {
			key, query := key, query
			wg.Add(1)
			go func() {
				defer wg.Done()
				points, queryErr := s.prometheus.QueryRange(ctx, query, start, end, time.Minute)
				if queryErr != nil || len(points) == 0 {
					return
				}
				mu.Lock()
				values[key] = points[len(points)-1].Value
				mu.Unlock()
			}()
		}
		wg.Wait()
		status.ProductsPerSecond = values["products"]
		status.BytesPerSecond = values["bytes"]
		status.QueueDepth = values["queue"]
		status.InflightProducts = values["inflight"]
	}
	s.runtimeMu.Lock()
	s.runtime = status
	if controlJob != nil {
		s.runtimeJob = controlJob
	}
	s.runtimeMu.Unlock()
	return status, nil
}

func (s *IngestService) Storage(ctx context.Context, prefix string, page, limit int) (*entity.StorageListing, error) {
	if s.objects == nil {
		return nil, fmt.Errorf("MinIO storage is unavailable")
	}
	prefix = strings.TrimSpace(prefix)
	if prefix == "" {
		prefix = "bronze/"
	}
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	if page < 1 {
		page = 1
	}
	objects, err := s.objects.ListObjects(ctx, prefix)
	if err != nil {
		return nil, err
	}
	sort.Slice(objects, func(i, j int) bool { return objects[i].LastModified.After(objects[j].LastModified) })
	var totalBytes int64
	for _, object := range objects {
		totalBytes += object.Size
	}
	start := (page - 1) * limit
	if start > len(objects) {
		start = len(objects)
	}
	end := start + limit
	if end > len(objects) {
		end = len(objects)
	}
	listing := &entity.StorageListing{Bucket: s.bucket, Prefix: prefix, Page: page, PageSize: limit, Total: len(objects), TotalBytes: totalBytes, Truncated: end < len(objects), Objects: make([]entity.StorageObject, 0, end-start)}
	for _, object := range objects[start:end] {
		listing.Objects = append(listing.Objects, entity.StorageObject{Key: object.Key, SizeBytes: object.Size, ETag: object.ETag, LastModified: object.LastModified})
	}
	return listing, nil
}
