package service

import (
	"context"
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

type fakeIngestPrometheus struct{}

func (fakeIngestPrometheus) QueryRange(_ context.Context, query string, _ time.Time, _ time.Time, _ time.Duration) ([]entity.MonitoringPoint, error) {
	value := 0.0
	if strings.Contains(query, "queue_depth") {
		value = 2
	}
	return []entity.MonitoringPoint{{Timestamp: 1, Value: value}}, nil
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
	if !status.Observed || status.RunID != "run-1" || status.TotalProducts != 2 || status.CompletedProducts != 1 || status.Downloading != 1 || status.QueueDepth != 2 {
		t.Fatalf("unexpected status: %#v", status)
	}
}

func TestIngestStorageCapsAndSortsListing(t *testing.T) {
	listing, err := NewIngestService(fakeIngestObjects{}, nil, "aurora").Storage(context.Background(), "bronze/", 1)
	if err != nil {
		t.Fatalf("storage: %v", err)
	}
	if listing.Total != 2 || !listing.Truncated || len(listing.Objects) != 1 || listing.Objects[0].Key != "bronze/new.fits" {
		t.Fatalf("unexpected listing: %#v", listing)
	}
}
