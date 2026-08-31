package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"go-api/internal/domain/entity"
	"go-api/internal/domain/repo"
)

type fakePreprocessingObjects struct{ data map[string][]byte }

func (f fakePreprocessingObjects) Ping(context.Context) error { return nil }
func (f fakePreprocessingObjects) ListObjects(_ context.Context, prefix string) ([]repo.ObjectInfo, error) {
	objects := make([]repo.ObjectInfo, 0)
	for key, data := range f.data {
		if strings.HasPrefix(key, prefix) {
			objects = append(objects, repo.ObjectInfo{Key: key, Size: int64(len(data)), LastModified: time.Now().UTC()})
		}
	}
	return objects, nil
}
func (f fakePreprocessingObjects) GetObject(_ context.Context, key string) ([]byte, error) {
	data, ok := f.data[key]
	if !ok {
		return nil, fmt.Errorf("%w: %s", repo.ErrObjectNotFound, key)
	}
	return data, nil
}
func (f fakePreprocessingObjects) PutObject(context.Context, string, []byte, string) error {
	return nil
}
func (f fakePreprocessingObjects) DeleteObject(context.Context, string) error { return nil }

type fakePreprocessingPrometheus struct {
	values map[string]float64
	err    error
}

func (f fakePreprocessingPrometheus) QueryRange(_ context.Context, query string, _ time.Time, _ time.Time, _ time.Duration) ([]entity.MonitoringPoint, error) {
	if f.err != nil {
		return nil, f.err
	}
	for key, value := range f.values {
		if strings.Contains(query, key) {
			return []entity.MonitoringPoint{{Timestamp: float64(time.Now().Unix()), Value: value}}, nil
		}
	}
	return []entity.MonitoringPoint{}, nil
}

func TestPreprocessingQueryReportsRunningFromLiveMetrics(t *testing.T) {
	svc := NewPreprocessingService(fakePreprocessingPrometheus{values: map[string]float64{
		"inflight_workers": 2,
		"queue_depth":      3,
		"products_total":   1,
		"errors_total":     0,
	}})
	graph, err := svc.Query(context.Background())
	if err != nil {
		t.Fatalf("query preprocessing: %v", err)
	}
	if graph.Status != "running" || len(graph.Hops) != 8 || graph.Hops[0].Status != "not_observed" {
		t.Fatalf("expected a running service without invented component state, got %#v", graph)
	}
	if graph.Source != "prometheus" || graph.ObservationScope != "preprocessor_service" {
		t.Fatalf("unexpected observation metadata: %#v", graph)
	}
}

func TestPreprocessingQueryKeepsNoDataGray(t *testing.T) {
	svc := NewPreprocessingService(fakePreprocessingPrometheus{values: map[string]float64{}})
	graph, err := svc.Query(context.Background())
	if err != nil {
		t.Fatalf("query preprocessing: %v", err)
	}
	if graph.Status != "not_observed" {
		t.Fatalf("expected not_observed, got %q", graph.Status)
	}
}

func TestPreprocessingQueryStillReturnsControlStateWhenPrometheusFails(t *testing.T) {
	svc := NewPreprocessingService(fakePreprocessingPrometheus{err: errors.New("down")})
	graph, err := svc.Query(context.Background())
	if err != nil || graph.Status != "not_observed" {
		t.Fatalf("expected an empty runtime graph, got graph=%#v err=%v", graph, err)
	}
}

func TestPreprocessingCountsActualUnprocessedBronzeFITS(t *testing.T) {
	objects := fakePreprocessingObjects{data: map[string][]byte{
		"bronze/tess/lightcurve/complete.fits":    []byte("fits"),
		"bronze/tess/lightcurve/pending.fits":     []byte("fits"),
		"bronze/tess/manifest.json":               []byte("metadata"),
		"silver/tess/lightcurve/complete.parquet": []byte("silver-data"),
		"silver/tess/lightcurve/metadata.json":    []byte("not-a-parquet-artifact"),
		"gold/snapshots/run-1/lightcurve.parquet": []byte("gold-data"),
		"gold/snapshots/run-1/manifest.json":      []byte("manifest"),
		"checkpoints/preprocessing/objects/complete.json": []byte(`{
			"state":"COMPLETED", "bronze_object_key":"bronze/tess/lightcurve/complete.fits"
		}`),
		"checkpoints/preprocessing/objects/pending.json": []byte(`{
			"state":"FAILED", "bronze_object_key":"bronze/tess/lightcurve/pending.fits"
		}`),
	}}
	svc := NewPreprocessingServiceWithEventsAndObjects(fakePreprocessingPrometheus{}, nil, nil, objects).(*PreprocessingService)
	svc.refreshCheckpointProgress(context.Background())
	graph, err := svc.Query(context.Background())
	if err != nil {
		t.Fatalf("query preprocessing: %v", err)
	}
	if !graph.Progress.BronzeObserved || graph.Progress.BronzeTotal != 2 || graph.Progress.BronzeCompleted != 1 || graph.Progress.BronzePending != 0 || graph.Progress.BronzeFailed != 1 {
		t.Fatalf("unexpected Bronze progress: %#v", graph.Progress)
	}
	if graph.Progress.ItemsToProcess != 0 || graph.Progress.CheckpointFailed != 1 || graph.Hops[0].Metrics["failed_files"] != 1 {
		t.Fatalf("expected terminal failure separated from processable Bronze backlog, got %#v", graph)
	}
	lineage := graph.Hops[5].Metrics
	if !graph.Progress.FootprintObserved || lineage["bronze_bytes"] != 8 || lineage["silver_bytes"] != 11 || lineage["silver_objects"] != 1 || lineage["gold_bytes"] != 0 || lineage["gold_objects"] != 0 {
		t.Fatalf("expected Bronze-to-Silver footprint without synthetic or downstream Gold metrics, progress=%#v metrics=%#v", graph.Progress, lineage)
	}
}

func TestPreprocessingRuntimeEventsDriveWorkerSnapshot(t *testing.T) {
	svc := NewPreprocessingService(fakePreprocessingPrometheus{}).(*PreprocessingService)
	now := time.Now().UTC()
	svc.ObserveRuntime(entity.PreprocessingRuntimeEvent{Event: "worker_spawned", WorkerID: "preprocess-01", OccurredAt: now})
	svc.ObserveRuntime(entity.PreprocessingRuntimeEvent{Event: "file_started", WorkerID: "preprocess-01", ProductKind: "lightcurve", ObjectKey: "bronze/example.fits", Stage: "scientific_transform", OccurredAt: now})
	svc.ObserveRuntime(entity.PreprocessingRuntimeEvent{Event: "file_completed", WorkerID: "preprocess-01", ElapsedMS: 125, OccurredAt: now.Add(time.Second)})

	graph, err := svc.Query(context.Background())
	if err != nil {
		t.Fatalf("query runtime graph: %v", err)
	}
	if graph.Runtime.ActualWorkers != 1 || graph.Runtime.Processing != 0 || graph.Runtime.Completed != 1 || graph.Runtime.Throughput <= 0 {
		t.Fatalf("unexpected runtime snapshot: %#v", graph.Runtime)
	}
	if len(graph.Runtime.Workers) != 1 || graph.Runtime.Workers[0].LastDurationMS != 125 || len(graph.Runtime.Trace) != 3 {
		t.Fatalf("expected worker state and bounded trace, got %#v", graph.Runtime)
	}
}
