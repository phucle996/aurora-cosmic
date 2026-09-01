package service

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"testing"
	"time"

	"go-api/internal/domain/entity"
	"go-api/internal/domain/repo"

	"github.com/parquet-go/parquet-go"
)

func TestNormalizedFluxScatterPPM(t *testing.T) {
	var output bytes.Buffer
	writer := parquet.NewGenericWriter[lightCurveScatterRow](&output)
	if _, err := writer.Write([]lightCurveScatterRow{{Flux: -0.001}, {Flux: 0.001}}); err != nil {
		t.Fatalf("write Light Curve parquet: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close Light Curve parquet: %v", err)
	}
	scatter, err := normalizedFluxScatterPPM(output.Bytes())
	if err != nil || math.Abs(scatter-1000) > 0.01 {
		t.Fatalf("expected 1000 ppm scatter, got scatter=%v err=%v", scatter, err)
	}
}

type fakePreprocessingObjects struct {
	data     map[string][]byte
	metadata map[string]map[string]string
}

func (f fakePreprocessingObjects) Ping(context.Context) error { return nil }
func (f fakePreprocessingObjects) ListObjects(_ context.Context, prefix string) ([]repo.ObjectInfo, error) {
	return f.listObjects(prefix, false)
}
func (f fakePreprocessingObjects) ListObjectsWithMetadata(_ context.Context, prefix string) ([]repo.ObjectInfo, error) {
	return f.listObjects(prefix, true)
}
func (f fakePreprocessingObjects) listObjects(prefix string, withMetadata bool) ([]repo.ObjectInfo, error) {
	objects := make([]repo.ObjectInfo, 0)
	for key, data := range f.data {
		if strings.HasPrefix(key, prefix) {
			var metadata map[string]string
			if withMetadata {
				metadata = f.metadata[key]
			}
			objects = append(objects, repo.ObjectInfo{Key: key, Size: int64(len(data)), LastModified: time.Now().UTC(), UserMetadata: metadata})
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

func preprocessingHopByID(t *testing.T, graph *entity.PreprocessingGraph, id string) entity.PreprocessingHop {
	t.Helper()
	for _, hop := range graph.Hops {
		if hop.ID == id {
			return hop
		}
	}
	t.Fatalf("preprocessing hop %q was not returned", id)
	return entity.PreprocessingHop{}
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
	if graph.Status != "running" || len(graph.Hops) != 13 || graph.Hops[0].Status != "not_observed" || len(graph.Edges) != 13 {
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

func TestPreprocessingCompletedControlStateRequiresDurableChartEvidence(t *testing.T) {
	svc := NewPreprocessingService(fakePreprocessingPrometheus{}).(*PreprocessingService)
	svc.runtimeJob = &entity.PreprocessingControlJob{JobID: "preprocess-run", Status: "completed"}

	graph, err := svc.Query(context.Background())
	if err != nil {
		t.Fatalf("query preprocessing without inventory: %v", err)
	}
	if graph.Status == "completed" {
		t.Fatalf("completed control state must not produce an empty completed DAG: %#v", graph.Progress)
	}

	svc.progress = entity.PreprocessingProgress{
		BronzeObserved:      true,
		FootprintObserved:   true,
		BronzeTotal:         1,
		CheckpointCompleted: 1,
		SilverTotal:         1,
		SilverBytes:         128,
	}
	graph, err = svc.Query(context.Background())
	if err != nil {
		t.Fatalf("query preprocessing with durable evidence: %v", err)
	}
	if graph.Status != "completed" {
		t.Fatalf("expected completed DAG once chart evidence is available, got %q", graph.Status)
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
			"state":"COMPLETED", "product_kind":"LIGHT_CURVE", "bronze_object_key":"bronze/tess/lightcurve/complete.fits"
		}`),
		"checkpoints/preprocessing/objects/pending.json": []byte(`{
			"state":"FAILED", "product_kind":"LIGHT_CURVE", "bronze_object_key":"bronze/tess/lightcurve/pending.fits",
			"last_error_kind":"PARQUET_ENCODE_FAILED", "last_error":"Failed to finalize Parquet file writer"
		}`),
	}, metadata: map[string]map[string]string{
		"silver/tess/lightcurve/complete.parquet": {
			"bronze-object-key": "bronze/tess/lightcurve/complete.fits", "parquet-encode-duration-ms": "12.5", "input-points": "100", "output-points": "90", "quality-removed": "6", "invalid-removed": "2", "nonfinite-removed": "1", "nonpositive-time-removed": "1", "outlier-removed": "2", "sigma-clip-4-5-removed": "1", "sigma-clip-ge-5-removed": "1", "sigma-clip-level": "4", "normalized-scatter-before-clip-ppm": "1200", "normalized-scatter-after-clip-ppm": "800",
		},
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
	if graph.Progress.BronzeLightCurves != 2 || graph.Progress.SilverLightCurves != 1 || graph.Progress.CompletedLightCurves != 1 {
		t.Fatalf("expected durable product-kind evidence for completed charts, got %#v", graph.Progress)
	}
	lcQuality := preprocessingHopByID(t, graph, "lc-quality")
	lcTransform := preprocessingHopByID(t, graph, "lc-transform")
	lcParquet := preprocessingHopByID(t, graph, "lc-parquet")
	if lcQuality.Metrics["completed_lightcurves"] != 1 || lcTransform.Metrics["completed_lightcurves"] != 1 || lcParquet.Metrics["silver_lightcurves"] != 1 {
		t.Fatalf("expected completed LC lane phases to expose durable evidence, got quality=%#v transform=%#v parquet=%#v", lcQuality.Metrics, lcTransform.Metrics, lcParquet.Metrics)
	}
	if lcQuality.Metrics["science_counts_observed"] != 1 || lcQuality.Metrics["lc_input_samples"] != 100 || lcQuality.Metrics["lc_quality_removed"] != 6 || lcQuality.Metrics["lc_invalid_removed"] != 2 {
		t.Fatalf("expected durable LC quality attrition evidence from Silver metadata, got %#v", lcQuality.Metrics)
	}
	if lcQuality.Metrics["lc_nonfinite_removed"] != 1 || lcQuality.Metrics["lc_nonpositive_removed"] != 1 {
		t.Fatalf("expected durable invalid-reason breakdown from Silver metadata, got %#v", lcQuality.Metrics)
	}
	transform := lcTransform.Metrics
	if transform["lc_preclip_samples"] != 92 || transform["lc_retained_samples"] != 90 || transform["lc_outlier_removed"] != 2 || transform["lc_scatter_before_p50_durable"] != 1200 || transform["lc_scatter_after_p50_durable"] != 800 {
		t.Fatalf("expected durable scientific transform evidence, got %#v", transform)
	}
	if transform["lc_sigma_clip_4_5_removed"] != 1 || transform["lc_sigma_clip_ge_5_removed"] != 1 {
		t.Fatalf("expected durable sigma rejection bands, got %#v", transform)
	}
	if len(lcTransform.ScatterPoints) != 1 || lcTransform.ScatterPoints[0].BeforePPM != 1200 || lcTransform.ScatterPoints[0].AfterPPM != 800 || lcTransform.ScatterPoints[0].SigmaClipLevel != 4 {
		t.Fatalf("expected per-product before/after scatter evidence, got %#v", lcTransform.ScatterPoints)
	}
	if len(lcParquet.MaterializationPoints) != 1 || lcParquet.MaterializationPoints[0].Rows != 90 || lcParquet.MaterializationPoints[0].SourceBytes != 4 || lcParquet.MaterializationPoints[0].EncodeDurationMS != 12.5 {
		t.Fatalf("expected per-artifact Parquet evidence, got %#v", lcParquet.MaterializationPoints)
	}
	if len(lcParquet.EncodeFailures) != 1 || lcParquet.EncodeFailures[0].Reason == "" || lcParquet.EncodeFailures[0].Recovered {
		t.Fatalf("expected phase-specific Parquet failure evidence, got %#v", lcParquet.EncodeFailures)
	}
	lineage := preprocessingHopByID(t, graph, "lineage").Metrics
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
