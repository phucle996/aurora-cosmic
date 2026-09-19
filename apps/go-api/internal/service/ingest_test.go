package service

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"go-api/infra/nats"
	"go-api/internal/domain/entity"
	"go-api/internal/provider"
)

type fakeIngestObjects struct{ objects map[string][]byte }

func (f fakeIngestObjects) Ping(context.Context) error { return nil }
func (f fakeIngestObjects) GetObject(_ context.Context, key string) ([]byte, error) {
	return f.objects[key], nil
}
func (f fakeIngestObjects) ListObjects(_ context.Context, prefix string) ([]provider.ObjectInfo, error) {
	return []provider.ObjectInfo{
		{Key: prefix + "new.fits", Size: 42, LastModified: time.Now().UTC()},
		{Key: prefix + "old.fits", Size: 20, LastModified: time.Now().UTC().Add(-time.Hour)},
	}, nil
}
func (f fakeIngestObjects) ListObjectsWithMetadata(ctx context.Context, prefix string) ([]provider.ObjectInfo, error) {
	return f.ListObjects(ctx, prefix)
}
func (f fakeIngestObjects) ListObjectsCursor(_ context.Context, prefix string, cursor string, limit int) ([]provider.ObjectInfo, string, bool, error) {
	all := []provider.ObjectInfo{
		{Key: prefix + "a.fits", Size: 42, LastModified: time.Now().UTC()},
		{Key: prefix + "b.fits", Size: 20, LastModified: time.Now().UTC()},
		{Key: prefix + "c.fits", Size: 15, LastModified: time.Now().UTC()},
	}
	var filtered []provider.ObjectInfo
	for _, obj := range all {
		if cursor != "" && obj.Key <= cursor {
			continue
		}
		filtered = append(filtered, obj)
	}

	if limit <= 0 {
		limit = 100
	}
	if len(filtered) <= limit {
		return filtered, "", false, nil
	}
	return filtered[:limit], filtered[limit-1].Key, true, nil
}
func (f fakeIngestObjects) PutObject(_ context.Context, key string, data []byte, _ string) error {
	if f.objects != nil {
		f.objects[key] = data
	}
	return nil
}
func (f fakeIngestObjects) DeleteObject(_ context.Context, key string) error {
	if f.objects != nil {
		delete(f.objects, key)
	}
	return nil
}

type fakePublisher struct{}

func (fakePublisher) Publish(context.Context, string, provider.Event) error { return nil }

func fakeNATSClient(job *entity.IngestControlJob, err error) *nats.Client {
	return &nats.Client{
		RequestFunc: func(_ context.Context, _ string, _ []byte) ([]byte, error) {
			if err != nil {
				return nil, err
			}
			if job == nil {
				return nil, nil
			}
			return json.Marshal(job)
		},
		PublishFunc: func(_ context.Context, _ string, _ []byte) error {
			return err
		},
	}
}

func TestIngestCancelRejectsWhenNATSUnavailable(t *testing.T) {
	natsClient := fakeNATSClient(nil, errors.New("nats unavailable"))
	svc := NewIngestService(fakeIngestObjects{}, "aurora", natsClient, fakePublisher{})
	if _, err := svc.Cancel(context.Background(), "run-1"); err == nil {
		t.Fatal("expected cancel failure when NATS fails")
	}
}

func TestIngestCancelSetsDrainingState(t *testing.T) {
	now := time.Now().UTC()
	natsClient := fakeNATSClient(&entity.IngestControlJob{TicketID: "ingest-job-drain", Status: "draining", UpdatedAt: now}, nil)
	svc := NewIngestService(fakeIngestObjects{}, "aurora", natsClient, fakePublisher{}).(*IngestService)
	svc.runtime = &entity.IngestStatus{TicketID: "ingest-job-drain", Status: "running", Downloading: 2, InflightProducts: 2}

	job, err := svc.Cancel(context.Background(), "ingest-job-drain")
	if err != nil || job.Status != "draining" {
		t.Fatalf("cancel job=%+v err=%v", job, err)
	}
	if svc.runtime.Status != "draining" {
		t.Fatalf("expected draining status, got %+v", svc.runtime)
	}
}

func TestIngestStatusProjectsRealtimeEvents(t *testing.T) {
	svc := NewIngestService(fakeIngestObjects{}, "aurora", fakeNATSClient(nil, nil), fakePublisher{}).(*IngestService)

	// 1. Initial state before any events
	status, err := svc.Status(context.Background())
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	if status.Observed || status.Status != "not_observed" {
		t.Fatalf("expected not_observed before events, got %#v", status)
	}

	// 2. Planning event
	svc.handleRuntimeEvent([]byte(`{
		"ticket_id": "tic-test-1",
		"status": "planning",
		"planning_stage": "DISCOVERING_MAST_PRODUCTS",
		"planning_completed": 3,
		"planning_total": 5,
		"planning_products": 42
	}`))

	status, err = svc.Status(context.Background())
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	if !status.Observed || status.Status != "planning" || status.ManifestProgress == nil {
		t.Fatalf("expected planning state, got %#v", status)
	}
	if status.ManifestProgress.Stage != "DISCOVERING_MAST_PRODUCTS" || status.ManifestProgress.DiscoveredProducts != 42 {
		t.Fatalf("unexpected manifest progress: %#v", status.ManifestProgress)
	}

	// 3. Transfer event (worker active)
	svc.handleRuntimeEvent([]byte(`{
		"ticket_id": "tic-test-1",
		"status": "transfer",
		"worker_id": 1,
		"product_id": "product-fits-1",
		"product_kind": "light_curve",
		"product_bytes": 1024,
		"product_expected_bytes": 2048,
		"active_workers": 1
	}`))

	status, err = svc.Status(context.Background())
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	if len(status.Products) != 1 || status.Products[0].ID != "product-fits-1" || status.Products[0].State != "downloading" {
		t.Fatalf("expected active downloading product, got %#v", status.Products)
	}

	// 4. Progress event with throughput
	svc.lastProgressAt = time.Now().UTC().Add(-time.Second)
	svc.lastCompletedBytes = 500
	svc.lastCompletedProducts = 0
	svc.handleRuntimeEvent([]byte(`{
		"ticket_id": "tic-test-1",
		"status": "progress",
		"completed_products": 1,
		"total_products": 10,
		"completed_bytes": 1500,
		"expected_bytes": 10000,
		"active_workers": 2
	}`))

	status, err = svc.Status(context.Background())
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	if status.CompletedProducts != 1 || status.TotalProducts != 10 || status.CompletedBytes != 1500 {
		t.Fatalf("unexpected progress: %#v", status)
	}
	if status.BytesPerSecond <= 0 {
		t.Fatalf("expected positive BytesPerSecond, got %f", status.BytesPerSecond)
	}

	// 5. Completion event clears live rates
	svc.handleRuntimeEvent([]byte(`{
		"ticket_id": "tic-test-1",
		"status": "completed"
	}`))
	status, err = svc.Status(context.Background())
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	if status.Status != "completed" || status.InflightProducts != 0 || status.BytesPerSecond != 0 {
		t.Fatalf("expected completed status with 0 live rate, got %#v", status)
	}
}

func TestIngestStorageCursorStreaming(t *testing.T) {
	svc := NewIngestService(fakeIngestObjects{}, "aurora", fakeNATSClient(nil, nil), fakePublisher{})

	// Page 1: limit 2
	page1, err := svc.Storage(context.Background(), "bronze/", "", 2)
	if err != nil {
		t.Fatalf("page 1 storage: %v", err)
	}
	if len(page1.Objects) != 2 || !page1.Truncated || page1.NextCursor != "bronze/b.fits" {
		t.Fatalf("unexpected page 1: %#v", page1)
	}
	if page1.Objects[0].Key != "bronze/a.fits" || page1.Objects[1].Key != "bronze/b.fits" {
		t.Fatalf("unexpected page 1 keys: %#v", page1.Objects)
	}

	// Page 2: resume from next_cursor
	page2, err := svc.Storage(context.Background(), "bronze/", page1.NextCursor, 2)
	if err != nil {
		t.Fatalf("page 2 storage: %v", err)
	}
	if len(page2.Objects) != 1 || page2.Truncated || page2.NextCursor != "" {
		t.Fatalf("unexpected page 2: %#v", page2)
	}
	if page2.Objects[0].Key != "bronze/c.fits" {
		t.Fatalf("unexpected page 2 keys: %#v", page2.Objects)
	}
}

func TestIngestStatusSyncsWithNATSControlPlane(t *testing.T) {
	natsClient := fakeNATSClient(&entity.IngestControlJob{
		TicketID:     "ingest-ticket-live",
		Status:       "running",
		ManifestPath: "remote:tess/sector=42",
		StartedAt:    time.Now().UTC(),
		UpdatedAt:    time.Now().UTC(),
	}, nil)

	status, err := NewIngestService(fakeIngestObjects{}, "aurora", natsClient, fakePublisher{}).Status(context.Background())
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	if status.Status != "running" || status.TicketID != "ingest-ticket-live" {
		t.Fatalf("expected status synced from NATS control plane, got %#v", status)
	}
}
