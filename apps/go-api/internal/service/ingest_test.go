package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"go-api/internal/domain/entity"
	"go-api/internal/domain/repo"
)

type fakeIngestObjects struct{ objects map[string][]byte }

func (f fakeIngestObjects) Ping(context.Context) error { return nil }
func (f fakeIngestObjects) GetObject(_ context.Context, key string) ([]byte, error) {
	return f.objects[key], nil
}
func (f fakeIngestObjects) ListObjects(_ context.Context, prefix string) ([]repo.ObjectInfo, error) {
	return []repo.ObjectInfo{
		{Key: prefix + "new.fits", Size: 42, LastModified: time.Now().UTC()},
		{Key: prefix + "old.fits", Size: 20, LastModified: time.Now().UTC().Add(-time.Hour)},
	}, nil
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

type fakeIngestPrometheus struct{}

func (fakeIngestPrometheus) QueryRange(_ context.Context, query string, _ time.Time, _ time.Time, _ time.Duration) ([]entity.MonitoringPoint, error) {
	value := 0.0
	if strings.Contains(query, "queue_depth") {
		value = 2
	}
	return []entity.MonitoringPoint{{Timestamp: 1, Value: value}}, nil
}

type fakeRuntimeIngestController struct{ job *entity.IngestControlJob }

func (f fakeRuntimeIngestController) Start(context.Context, entity.IngestStartRequest) (*entity.IngestControlJob, error) {
	return f.job, nil
}
func (f fakeRuntimeIngestController) Cancel(context.Context, string) (*entity.IngestControlJob, error) {
	return f.job, nil
}
func (f fakeRuntimeIngestController) Current(context.Context) (*entity.IngestControlJob, error) {
	return f.job, nil
}

type failingIngestController struct{}

func (failingIngestController) Start(context.Context, entity.IngestStartRequest) (*entity.IngestControlJob, error) {
	return nil, errors.New("unavailable")
}
func (failingIngestController) Cancel(context.Context, string) (*entity.IngestControlJob, error) {
	return nil, errors.New("unavailable")
}

func TestIngestCancelDoesNotFabricateStateOrRewriteCheckpoint(t *testing.T) {
	checkpoint := []byte(`{"run_id":"run-1","status":"RUNNING","products":{"a":{"state":"DOWNLOADING"}}}`)
	objects := fakeIngestObjects{objects: map[string][]byte{
		"checkpoints/ingestion/current.json":    []byte(`{"active_run_id":"run-1"}`),
		"checkpoints/ingestion/runs/run-1.json": checkpoint,
	}}
	service := NewIngestServiceWithEvents(objects, nil, "aurora", failingIngestController{}, nil)
	if _, err := service.Cancel(context.Background(), "run-1"); err == nil {
		t.Fatal("cancel succeeded even though the ingester rejected it")
	}
	if got := string(objects.objects["checkpoints/ingestion/runs/run-1.json"]); got != string(checkpoint) {
		t.Fatalf("API rewrote ingester checkpoint: %s", got)
	}
}

func TestIngestCancelPreservesActiveDownloadsWhileDraining(t *testing.T) {
	now := time.Now().UTC()
	controller := fakeRuntimeIngestController{job: &entity.IngestControlJob{JobID: "ingest-job-drain", Status: "draining", UpdatedAt: now}}
	svc := NewIngestServiceWithEvents(fakeIngestObjects{}, nil, "aurora", controller, nil).(*IngestService)
	svc.runtime = &entity.IngestStatus{Status: "running", Downloading: 2, InflightProducts: 2}

	job, err := svc.Cancel(context.Background(), "ingest-job-drain")
	if err != nil || job.Status != "draining" {
		t.Fatalf("cancel job=%+v err=%v", job, err)
	}
	if svc.runtime.Status != "draining" || svc.runtime.Downloading != 2 || svc.runtime.InflightProducts != 2 {
		t.Fatalf("API erased draining worker state: %+v", svc.runtime)
	}
}

func TestIngestStatusReadsCheckpointAndTelemetry(t *testing.T) {
	objects := fakeIngestObjects{objects: map[string][]byte{
		"checkpoints/ingestion/current.json":    []byte(`{"active_run_id":"run-1"}`),
		"checkpoints/ingestion/runs/run-1.json": []byte(`{"run_id":"run-1","status":"RUNNING","manifest_path":"manifest.json","products":{"a":{"product_kind":"LIGHTCURVE","object_key":"bronze/a","expected_size_bytes":100,"size_bytes":50,"state":"DOWNLOADING","attempts":1,"updated_at":"2026-08-09T00:00:00Z"},"b":{"product_kind":"TPF","object_key":"bronze/b","expected_size_bytes":200,"size_bytes":200,"state":"PUBLISHED","updated_at":"2026-08-09T00:00:01Z"}}}`),
	}}
	status, err := NewIngestService(objects, fakeIngestPrometheus{}, "aurora").Status(context.Background())
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	if !status.Observed || status.RunID != "run-1" || status.TotalProducts != 2 || status.CompletedProducts != 1 || status.Downloading != 1 || status.InflightProducts != 1 || status.QueueDepth != 2 {
		t.Fatalf("unexpected status: %#v", status)
	}
}

func TestIngestStorageCapsAndSortsListing(t *testing.T) {
	listing, err := NewIngestService(fakeIngestObjects{}, nil, "aurora").Storage(context.Background(), "bronze/", 1, 1)
	if err != nil {
		t.Fatalf("storage: %v", err)
	}
	if listing.Total != 2 || listing.TotalBytes != 62 || !listing.Truncated || len(listing.Objects) != 1 || listing.Objects[0].Key != "bronze/new.fits" {
		t.Fatalf("unexpected listing: %#v", listing)
	}
}

func TestIngestStatusPrefersFreshRuntimeJobOverOlderCheckpoint(t *testing.T) {
	objects := fakeIngestObjects{objects: map[string][]byte{
		"checkpoints/ingestion/current.json":      []byte(`{"active_run_id":"old-run"}`),
		"checkpoints/ingestion/runs/old-run.json": []byte(`{"run_id":"old-run","status":"COMPLETED","manifest_path":"remote:tess/sector=42/limit=10","started_at":"2026-08-09T00:00:00Z","updated_at":"2026-08-09T00:01:00Z","products":{"old":{"product_kind":"LIGHTCURVE","state":"PUBLISHED","size_bytes":100,"updated_at":"2026-08-09T00:01:00Z"}}}`),
	}}
	controller := fakeRuntimeIngestController{job: &entity.IngestControlJob{JobID: "ingest-job-live", Status: "running", ManifestPath: "remote:tess/sector=42/limit=all", StartedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC()}}
	status, err := NewIngestServiceWithEvents(objects, nil, "aurora", controller, nil).Status(context.Background())
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	if status.Source != "api-runtime" || status.Status != "running" || status.ControlJobID != "ingest-job-live" || status.TotalProducts != 0 {
		t.Fatalf("expected fresh runtime state, got %#v", status)
	}
}

func TestIngestStatusReportsPlanningFromActiveControlRun(t *testing.T) {
	objects := fakeIngestObjects{objects: map[string][]byte{
		"checkpoints/ingestion/current.json":      []byte(`{"active_run_id":"old-run"}`),
		"checkpoints/ingestion/runs/old-run.json": []byte(`{"run_id":"old-run","status":"COMPLETED","updated_at":"2026-08-09T00:01:00Z","products":{}}`),
		"control/ingest/catalog-status.json":      []byte(`{"state":"RUNNING","stage":"DOWNLOADING_TOI","completed":1,"total":2}`),
		"control/ingest/manifest-status.json":     []byte(`{"state":"PLANNED","stage":"DISCOVERING_MAST_PRODUCTS","completed":0,"total":5}`),
	}}
	now := time.Now().UTC()
	controller := fakeRuntimeIngestController{job: &entity.IngestControlJob{JobID: "ingest-job-planning", Status: "running", StartedAt: now, UpdatedAt: now}}
	status, err := NewIngestServiceWithEvents(objects, nil, "aurora", controller, nil).Status(context.Background())
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	if status.Status != "planning" || status.CatalogProgress == nil || status.ManifestProgress == nil {
		t.Fatalf("expected backend planning status with durable progress, got %#v", status)
	}
}

func TestIngestStatusUsesTerminalControlStateOverCheckpoint(t *testing.T) {
	objects := fakeIngestObjects{objects: map[string][]byte{
		"checkpoints/ingestion/current.json":    []byte(`{"active_run_id":"run-1"}`),
		"checkpoints/ingestion/runs/run-1.json": []byte(`{"run_id":"run-1","status":"RUNNING","updated_at":"2026-08-09T12:00:00Z","products":{}}`),
	}}
	controller := fakeRuntimeIngestController{job: &entity.IngestControlJob{
		JobID:     "ingest-job-canceled",
		Status:    "canceled",
		StartedAt: time.Date(2026, 8, 9, 11, 0, 0, 0, time.UTC),
		UpdatedAt: time.Date(2026, 8, 9, 12, 1, 0, 0, time.UTC),
	}}
	status, err := NewIngestServiceWithEvents(objects, fakeIngestPrometheus{}, "aurora", controller, nil).Status(context.Background())
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	if status.Status != "canceled" || status.ControlJobID != "ingest-job-canceled" || status.QueueDepth != 0 || status.BytesPerSecond != 0 {
		t.Fatalf("expected terminal control state and zero live rates, got %#v", status)
	}
}
