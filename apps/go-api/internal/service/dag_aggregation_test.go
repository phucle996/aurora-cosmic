package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"go-api/internal/domain/entity"
	"go-api/internal/provider"
)

type fakePrometheusQuerier struct {
	points map[string][]entity.MonitoringPoint
}

func (f *fakePrometheusQuerier) QueryRange(_ context.Context, query string, _ time.Time, _ time.Time, _ time.Duration) ([]entity.MonitoringPoint, error) {
	if pts, ok := f.points[query]; ok {
		return pts, nil
	}
	for key, pts := range f.points {
		if strings.Contains(query, key) {
			return pts, nil
		}
	}
	return []entity.MonitoringPoint{
		{Timestamp: float64(time.Now().Unix()), Value: 42.0},
	}, nil
}

type fakePreprocessingObjects struct {
	data map[string][]byte
}

func (f fakePreprocessingObjects) Ping(context.Context) error { return nil }
func (f fakePreprocessingObjects) ListObjects(_ context.Context, prefix string) ([]provider.ObjectInfo, error) {
	return nil, nil
}
func (f fakePreprocessingObjects) ListObjectsWithMetadata(_ context.Context, prefix string) ([]provider.ObjectInfo, error) {
	return nil, nil
}
func (f fakePreprocessingObjects) ListObjectsCursor(_ context.Context, prefix string, cursor string, limit int) ([]provider.ObjectInfo, string, bool, error) {
	return nil, "", false, nil
}
func (f fakePreprocessingObjects) GetObject(_ context.Context, key string) ([]byte, error) {
	data, ok := f.data[key]
	if !ok {
		return nil, fmt.Errorf("%w: %s", provider.ErrObjectNotFound, key)
	}
	return data, nil
}
func (f fakePreprocessingObjects) PutObject(context.Context, string, []byte, string) error {
	return nil
}
func (f fakePreprocessingObjects) DeleteObject(context.Context, string) error { return nil }

type fakePreprocessingController struct {
	job *entity.PreprocessingControlJob
}

func (f *fakePreprocessingController) Start(context.Context, entity.PreprocessingStartRequest) (*entity.PreprocessingControlJob, error) {
	return nil, nil
}
func (f *fakePreprocessingController) Stop(context.Context, string) (*entity.PreprocessingControlJob, error) {
	return nil, nil
}
func (f *fakePreprocessingController) GetActiveJob(context.Context) (*entity.PreprocessingControlJob, error) {
	return f.job, nil
}

func TestDAGAggregationUnknownHop(t *testing.T) {
	svc := NewDAGAggregationService(nil, &fakePrometheusQuerier{}, nil, nil)
	_, err := svc.AggregateHopMetrics(context.Background(), "ticket-123", "nonexistent-hop")
	if err == nil || !strings.Contains(err.Error(), "unknown pipeline DAG hop") {
		t.Fatalf("expected unknown hop error, got %v", err)
	}
}

func TestDAGAggregationLCTransform(t *testing.T) {
	now := time.Now().UTC()
	checkpointData, _ := json.Marshal(map[string]any{
		"run_id":     "ticket-456",
		"started_at": now.Add(-10 * time.Minute).Format(time.RFC3339Nano),
		"updated_at": now.Format(time.RFC3339Nano),
		"status":     "completed",
	})

	objects := fakePreprocessingObjects{
		data: map[string][]byte{
			"checkpoints/preprocessing/runs/ticket-456.json": checkpointData,
		},
	}

	prom := &fakePrometheusQuerier{
		points: map[string][]entity.MonitoringPoint{
			"aurora_preprocessor_science_samples_total": {
				{Timestamp: float64(now.Unix()), Value: 1250.0},
			},
		},
	}

	svc := NewDAGAggregationService(nil, prom, objects, nil)
	hop, err := svc.AggregateHopMetrics(context.Background(), "ticket-456", "lc-transform")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if hop.ID != "lc-transform" {
		t.Fatalf("expected hop ID lc-transform, got %s", hop.ID)
	}
	if hop.Label == "" || hop.Contract == "" {
		t.Fatalf("expected hop label and contract to be populated, got label=%s contract=%s", hop.Label, hop.Contract)
	}
	if hop.Telemetry == nil {
		t.Fatalf("expected telemetry to be populated")
	}
	if len(hop.Telemetry["lc_output_rate"]) == 0 {
		t.Fatalf("expected lc_output_rate telemetry series")
	}
	if hop.Metrics["lc_output_rate"] != 1250.0 {
		t.Fatalf("expected lc_output_rate to be 1250.0, got %v", hop.Metrics["lc_output_rate"])
	}
}

func TestDAGAggregationAllCatalogHops(t *testing.T) {
	prom := &fakePrometheusQuerier{}
	svc := NewDAGAggregationService(nil, prom, nil, nil)

	catalogHops := []string{
		"bronze", "route", "lc-quality", "lc-transform", "lc-parquet",
		"tpf-quality", "tpf-transform", "tpf-parquet", "silver",
		"checkpoint", "lineage", "event", "ack",
		"gold-pairing", "gold-catalog", "gold-lc-features", "gold-bls",
		"gold-tpf-evidence", "gold-candidate", "gold-parquet", "gold-index", "gold-commit",
	}

	for _, hopID := range catalogHops {
		hop, err := svc.AggregateHopMetrics(context.Background(), "", hopID)
		if err != nil {
			t.Fatalf("hop %s failed: %v", hopID, err)
		}
		if hop.ID != hopID {
			t.Fatalf("expected hop ID %s, got %s", hopID, hop.ID)
		}
		if hop.Label == "" {
			t.Fatalf("expected hop %s to have a label", hopID)
		}
	}
}

func TestDAGAggregationQueryKeepsNoDataGray(t *testing.T) {
	svc := NewDAGAggregationService(nil, nil, nil, nil)
	graph, err := svc.QueryGraph(context.Background(), "", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if graph.Status != "not_observed" {
		t.Fatalf("expected not_observed, got %q", graph.Status)
	}
	if len(graph.Hops) != 19 {
		t.Fatalf("expected 19 hops in full DAG graph, got %d", len(graph.Hops))
	}
	if len(graph.Edges) != 22 {
		t.Fatalf("expected 22 edges in full DAG topology, got %d", len(graph.Edges))
	}
}

func TestDAGAggregationQueryReportsRunningFromLiveMetrics(t *testing.T) {
	svc := NewDAGAggregationService(nil, nil, nil, nil)
	now := time.Now().UTC()
	svc.ObserveRuntime(entity.PreprocessingRuntimeEvent{
		Event:       "file_started",
		WorkerID:    "worker-01",
		ProductKind: "lightcurve",
		ObjectKey:   "bronze/example.fits",
		Stage:       "decode",
		OccurredAt:  now,
	})
	graph, err := svc.QueryGraph(context.Background(), "", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if graph.Status != "running" || len(graph.Hops) != 19 || len(graph.Edges) != 22 {
		t.Fatalf("expected a running service with 19 hops and 22 edges, got %#v", graph)
	}
}

func TestDAGAggregationRuntimeEventsDriveWorkerSnapshot(t *testing.T) {
	svc := NewDAGAggregationService(nil, nil, nil, nil)
	now := time.Now().UTC()
	svc.ObserveRuntime(entity.PreprocessingRuntimeEvent{Event: "worker_spawned", WorkerID: "preprocess-01", OccurredAt: now})
	svc.ObserveRuntime(entity.PreprocessingRuntimeEvent{Event: "file_started", WorkerID: "preprocess-01", ProductKind: "lightcurve", ObjectKey: "bronze/example.fits", Stage: "scientific_transform", OccurredAt: now})
	svc.ObserveRuntime(entity.PreprocessingRuntimeEvent{Event: "file_completed", WorkerID: "preprocess-01", ElapsedMS: 125, OccurredAt: now.Add(time.Second)})

	graph, err := svc.QueryGraph(context.Background(), "", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if graph.Runtime.ActualWorkers != 1 || graph.Runtime.Processing != 0 || graph.Runtime.Completed != 1 || graph.Runtime.Throughput <= 0 {
		t.Fatalf("unexpected runtime snapshot: %#v", graph.Runtime)
	}
	if len(graph.Runtime.Workers) != 1 || graph.Runtime.Workers[0].LastDurationMS != 125 || len(graph.Runtime.Trace) != 3 {
		t.Fatalf("expected worker state and bounded trace, got %#v", graph.Runtime)
	}
}

func TestDAGAggregationObserveRuntimeDiscardsMismatchedTicket(t *testing.T) {
	ctrl := &fakePreprocessingController{
		job: &entity.PreprocessingControlJob{
			TicketID: "active-ticket-123",
			Status:   "running",
		},
	}
	svc := NewDAGAggregationService(nil, nil, nil, ctrl)

	// Event with mismatched ticket should be dropped
	svc.ObserveRuntime(entity.PreprocessingRuntimeEvent{
		Event:       "file_started",
		TicketID:    "old-stale-ticket",
		WorkerID:    "preprocess-01",
		ProductKind: "lightcurve",
		ObjectKey:   "bronze/old.fits",
		Stage:       "transform",
		OccurredAt:  time.Now().UTC(),
	})

	graph, _ := svc.QueryGraph(context.Background(), "", "")
	if len(graph.Runtime.Workers) != 0 || len(graph.Runtime.Trace) != 0 {
		t.Fatalf("expected mismatched ticket event to be dropped, got %d workers and %d trace items",
			len(graph.Runtime.Workers), len(graph.Runtime.Trace))
	}

	// Event with matching ticket should be accepted
	svc.ObserveRuntime(entity.PreprocessingRuntimeEvent{
		Event:       "file_started",
		TicketID:    "active-ticket-123",
		WorkerID:    "preprocess-01",
		ProductKind: "lightcurve",
		ObjectKey:   "bronze/new.fits",
		Stage:       "transform",
		OccurredAt:  time.Now().UTC(),
	})

	graph, _ = svc.QueryGraph(context.Background(), "", "")
	if len(graph.Runtime.Workers) != 1 || len(graph.Runtime.Trace) != 1 {
		t.Fatalf("expected matching ticket event to be accepted, got %d workers and %d trace items",
			len(graph.Runtime.Workers), len(graph.Runtime.Trace))
	}
}

func TestDAGAggregationQueryCumulativePrometheusMetrics(t *testing.T) {
	now := time.Now().UTC()
	ctrl := &fakePreprocessingController{
		job: &entity.PreprocessingControlJob{
			TicketID:  "ticket-cum-001",
			Status:    "running",
			StartedAt: now.Add(-30 * time.Minute),
			UpdatedAt: now,
		},
	}

	prom := &fakePrometheusQuerier{
		points: map[string][]entity.MonitoringPoint{
			`sum(aurora_preprocessor_products_total)`: {
				{Timestamp: float64(now.Unix()), Value: 50.0},
			},
			`sum(aurora_preprocessor_products_total{kind="lightcurve"})`: {
				{Timestamp: float64(now.Unix()), Value: 30.0},
			},
			`sum(aurora_preprocessor_products_total{kind="target_pixel"})`: {
				{Timestamp: float64(now.Unix()), Value: 20.0},
			},
			`sum(aurora_preprocessor_products_total{kind="lightcurve",status=~"success|recovered"})`: {
				{Timestamp: float64(now.Unix()), Value: 28.0},
			},
			`sum(aurora_preprocessor_products_total{kind="target_pixel",status=~"success|recovered"})`: {
				{Timestamp: float64(now.Unix()), Value: 18.0},
			},
			`sum(aurora_preprocessor_bytes_total{stage="silver"})`: {
				{Timestamp: float64(now.Unix()), Value: 1048576.0},
			},
		},
	}

	svc := NewDAGAggregationService(nil, prom, nil, ctrl)
	graph, err := svc.QueryGraph(context.Background(), "", "")
	if err != nil {
		t.Fatalf("unexpected QueryGraph error: %v", err)
	}

	if graph.Progress.BronzeTotal != 50 {
		t.Errorf("expected BronzeTotal=50, got %d", graph.Progress.BronzeTotal)
	}
	if graph.Progress.BronzeLightCurves != 30 {
		t.Errorf("expected BronzeLightCurves=30, got %d", graph.Progress.BronzeLightCurves)
	}
	if graph.Progress.BronzeTargetPixels != 20 {
		t.Errorf("expected BronzeTargetPixels=20, got %d", graph.Progress.BronzeTargetPixels)
	}
	if graph.Progress.CompletedLightCurves != 28 {
		t.Errorf("expected CompletedLightCurves=28, got %d", graph.Progress.CompletedLightCurves)
	}
	if graph.Progress.CompletedTargetPixels != 18 {
		t.Errorf("expected CompletedTargetPixels=18, got %d", graph.Progress.CompletedTargetPixels)
	}
	if graph.Progress.BronzeCompleted != 46 { // 28 + 18
		t.Errorf("expected BronzeCompleted=46, got %d", graph.Progress.BronzeCompleted)
	}
	if graph.Progress.SilverBytes != 1048576 {
		t.Errorf("expected SilverBytes=1048576, got %d", graph.Progress.SilverBytes)
	}
	if !graph.Progress.BronzeObserved || !graph.Progress.FootprintObserved {
		t.Errorf("expected BronzeObserved and FootprintObserved to be true")
	}
}

type fakeDAGRepository struct {
	evidence *entity.DAGRunEvidence
}

func (f *fakeDAGRepository) GetRunEvidence(context.Context, string) (*entity.DAGRunEvidence, error) {
	return f.evidence, nil
}

func TestDAGAggregationGoldHopsWithTicketEvidence(t *testing.T) {
	dagRepo := &fakeDAGRepository{
		evidence: &entity.DAGRunEvidence{
			RunID:          "ticket-gold-001",
			Status:         "COMPLETED",
			InputRecords:   420,
			OutputRows:     418,
			IndexedRows:    418,
			LastSnapshotID: "gold-snap-1234",
			ScientificEvidence: &entity.ScientificEvidence{
				LCFeatures: &entity.LCFeatureEvidence{
					Rows:          418,
					TotalCadences: 80000,
				},
				BLSSearch: &entity.BLSSearchEvidence{
					Evaluated: 418,
					Available: 410,
				},
				GoldCommit: &entity.GoldCommitEvidence{
					Rows: 418,
				},
			},
		},
	}

	svc := NewDAGAggregationService(dagRepo, nil, nil, nil)

	// Test gold-pairing
	hopPairing, err := svc.AggregateHopMetrics(context.Background(), "ticket-gold-001", "gold-pairing")
	if err != nil {
		t.Fatalf("unexpected error for gold-pairing: %v", err)
	}
	if hopPairing.Metrics["readiness_observed"] != 1 || hopPairing.Metrics["ready_lightcurves"] != 420 {
		t.Errorf("unexpected gold-pairing metrics: %#v", hopPairing.Metrics)
	}
	if hopPairing.Status != "completed" {
		t.Errorf("expected completed status, got %s", hopPairing.Status)
	}

	// Test gold-lc-features with evidence
	hopLC, err := svc.AggregateHopMetrics(context.Background(), "ticket-gold-001", "gold-lc-features")
	if err != nil {
		t.Fatalf("unexpected error for gold-lc-features: %v", err)
	}
	if hopLC.LCFeatureEvidence == nil || hopLC.LCFeatureEvidence.Rows != 418 {
		t.Errorf("expected LCFeatureEvidence with 418 rows, got %#v", hopLC.LCFeatureEvidence)
	}

	// Test gold-bls with evidence
	hopBLS, err := svc.AggregateHopMetrics(context.Background(), "ticket-gold-001", "gold-bls")
	if err != nil {
		t.Fatalf("unexpected error for gold-bls: %v", err)
	}
	if hopBLS.BLSSearchEvidence == nil || hopBLS.BLSSearchEvidence.Available != 410 {
		t.Errorf("expected BLSSearchEvidence with 410 available, got %#v", hopBLS.BLSSearchEvidence)
	}

	// Test gold-commit with evidence
	hopCommit, err := svc.AggregateHopMetrics(context.Background(), "ticket-gold-001", "gold-commit")
	if err != nil {
		t.Fatalf("unexpected error for gold-commit: %v", err)
	}
	if hopCommit.GoldCommitEvidence == nil || hopCommit.GoldCommitEvidence.Rows != 418 {
		t.Errorf("expected GoldCommitEvidence with 418 rows, got %#v", hopCommit.GoldCommitEvidence)
	}
	if hopCommit.Details["snapshot_id"] != "gold-snap-1234" {
		t.Errorf("expected detail snapshot_id to be gold-snap-1234, got %s", hopCommit.Details["snapshot_id"])
	}
}

func TestDAGAggregationGoldHopsLiveRuntime(t *testing.T) {
	runtimeStatusJSON, _ := json.Marshal(entity.EnrichmentRuntimeStatus{
		State:          "RUNNING",
		ActiveBuilds:   2,
		LastSnapshotID: "gold-live-5678",
		Readiness: entity.EnrichmentReadinessStatus{
			ReadyLightcurves:   150,
			MissingTPF:         10,
			WaitingLightcurves: 10,
			TPFContexts:        140,
		},
		CatalogSync: entity.EnrichmentCatalogSyncStatus{
			State:      "SYNCED",
			TICRecords: 150,
			TOIRecords: 15,
			CacheHit:   true,
		},
		Workers: []entity.EnrichmentWorkerStatus{
			{
				WorkerID:  "worker-1",
				Lifecycle: "PROCESSING",
				Action:    "EXTRACTING_FEATURES",
				StepIndex: 4,
			},
		},
	})
	controlJSON, _ := json.Marshal(entity.EnrichmentControlState{
		Mode:            "STREAM",
		MaxBatchRecords: 500,
	})

	objects := fakePreprocessingObjects{
		data: map[string][]byte{
			"control/enrichment.json":        controlJSON,
			"control/enrichment/status.json": runtimeStatusJSON,
		},
	}

	svc := NewDAGAggregationService(nil, nil, objects, nil)

	// Test live QueryGraph
	graph, err := svc.QueryGraph(context.Background(), "", "")
	if err != nil {
		t.Fatalf("unexpected QueryGraph error: %v", err)
	}
	if len(graph.Hops) != 19 {
		t.Fatalf("expected 19 hops, got %d", len(graph.Hops))
	}

	// Verify gold-pairing in live mode
	var pairingHop *entity.DAGHop
	for i := range graph.Hops {
		if graph.Hops[i].ID == "gold-pairing" {
			pairingHop = &graph.Hops[i]
			break
		}
	}
	if pairingHop == nil {
		t.Fatalf("gold-pairing hop not found in graph")
	}
	if pairingHop.Metrics["readiness_observed"] != 1 || pairingHop.Metrics["ready_lightcurves"] != 150 {
		t.Errorf("unexpected live metrics for gold-pairing: %#v", pairingHop.Metrics)
	}
	if pairingHop.Metrics["max_batch_records"] != 500 {
		t.Errorf("expected max_batch_records 500, got %v", pairingHop.Metrics["max_batch_records"])
	}
}

func TestDAGAggregationQueryGraphStageFiltering(t *testing.T) {
	svc := NewDAGAggregationService(nil, nil, nil, nil)

	allGraph, err := svc.QueryGraph(context.Background(), "all", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(allGraph.Hops) != 19 {
		t.Errorf("expected 19 hops for 'all', got %d", len(allGraph.Hops))
	}
	if len(allGraph.Edges) != 22 {
		t.Errorf("expected 22 edges for 'all', got %d", len(allGraph.Edges))
	}

	preGraph, err := svc.QueryGraph(context.Background(), "preprocessing", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(preGraph.Hops) != 13 {
		t.Errorf("expected 13 hops for 'preprocessing', got %d", len(preGraph.Hops))
	}
	for _, h := range preGraph.Hops {
		if strings.HasPrefix(h.ID, "gold-") {
			t.Errorf("unexpected gold hop in preprocessing stage: %s", h.ID)
		}
	}

	enrichGraph, err := svc.QueryGraph(context.Background(), "enrichment", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(enrichGraph.Hops) != 6 {
		t.Errorf("expected 6 hops for 'enrichment', got %d", len(enrichGraph.Hops))
	}
	for _, h := range enrichGraph.Hops {
		if !strings.HasPrefix(h.ID, "gold-") {
			t.Errorf("unexpected non-gold hop in enrichment stage: %s", h.ID)
		}
	}
}
