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

func (s *IngestService) Start(ctx context.Context, request entity.IngestStartRequest) (*entity.IngestControlJob, error) {
	if s.controller == nil {
		return nil, fmt.Errorf("ingester control is unavailable")
	}
	return s.controller.Start(ctx, request)
}

func (s *IngestService) Cancel(ctx context.Context, jobID string) (*entity.IngestControlJob, error) {
	if s.controller == nil {
		return nil, fmt.Errorf("ingester control is unavailable")
	}
	return s.controller.Cancel(ctx, jobID)
}

func (s *IngestService) Status(ctx context.Context) (*entity.IngestStatus, error) {
	if s.objects == nil {
		return nil, fmt.Errorf("MinIO ingestion checkpoint is unavailable")
	}
	data, err := s.objects.GetObject(ctx, "checkpoints/ingestion/current.json")
	if err != nil {
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
	if s.prometheus != nil {
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
	return status, nil
}

func (s *IngestService) Storage(ctx context.Context, prefix string, limit int) (*entity.StorageListing, error) {
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
	objects, err := s.objects.ListObjects(ctx, prefix)
	if err != nil {
		return nil, err
	}
	sort.Slice(objects, func(i, j int) bool { return objects[i].LastModified.After(objects[j].LastModified) })
	objectCount := len(objects)
	if objectCount > limit {
		objectCount = limit
	}
	listing := &entity.StorageListing{Bucket: s.bucket, Prefix: prefix, Total: len(objects), Truncated: len(objects) > limit, Objects: make([]entity.StorageObject, 0, objectCount)}
	for _, object := range objects[:objectCount] {
		listing.Objects = append(listing.Objects, entity.StorageObject{Key: object.Key, SizeBytes: object.Size, ETag: object.ETag, LastModified: object.LastModified})
	}
	return listing, nil
}
