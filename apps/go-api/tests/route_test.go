package tests

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"go-api/internal/app"
	"go-api/internal/config"
	"go-api/internal/domain/entity"
	"go-api/internal/domain/service"
	"go-api/internal/provider"
	"go-api/internal/transport/http/handler"
)

type fakeCandidate struct{}

func (fakeCandidate) ListCandidates(context.Context, entity.CandidateQuery) (entity.Page[entity.Candidate], error) {
	return entity.Page[entity.Candidate]{Items: []entity.Candidate{}, Limit: 100}, nil
}
func (fakeCandidate) GetCandidate(context.Context, string, string) (*entity.CandidateDetail, error) {
	return &entity.CandidateDetail{}, nil
}
func (fakeCandidate) ReviewCandidate(context.Context, entity.CandidateReviewInput) (*entity.CandidateReview, error) {
	return &entity.CandidateReview{
		Decision:     "CONFIRMED",
		ReviewStatus: "REVIEWED",
		Reviewer:     "HUMAN_OPERATOR",
	}, nil
}

type fakeAnomaly struct{}

func (fakeAnomaly) ListAnomalies(context.Context, int, string, bool, entity.PageRequest) (entity.Page[entity.Anomaly], error) {
	return entity.Page[entity.Anomaly]{Items: []entity.Anomaly{}, Limit: 100}, nil
}
func (fakeAnomaly) GetAnomalyDetail(context.Context, string, string) (*entity.AnomalyDetail, error) {
	return &entity.AnomalyDetail{}, nil
}

type fakeTarget struct{}

func (fakeTarget) ListTargets(context.Context, entity.TargetQuery) (entity.Page[entity.Target], error) {
	return entity.Page[entity.Target]{Items: []entity.Target{}, Limit: 100}, nil
}
func (fakeTarget) GetTarget(context.Context, int64, int, string) (*entity.TargetDetail, error) {
	return &entity.TargetDetail{}, nil
}
func (fakeTarget) GetLightcurve(context.Context, int64, int, entity.PageRequest) (*entity.Lightcurve, error) {
	return &entity.Lightcurve{TICID: 101, Time: []float64{}, Flux: []float64{}}, nil
}

type fakeModels struct{}

func (fakeModels) ListModels(context.Context, string) ([]entity.Model, error) {
	return []entity.Model{}, nil
}

func (fakeModels) GetModelEvaluation(context.Context, string) (*entity.ModelEvaluation, error) {
	return &entity.ModelEvaluation{RuntimePackageID: "runtime-test", EvaluationRunID: "eval-test"}, nil
}

func (fakeModels) ListTrainingReviews(context.Context, int) ([]entity.TrainingReview, error) {
	return nil, nil
}

func (fakeModels) ListTrainingReviewQueue(context.Context, []string, entity.PageRequest) (entity.Page[entity.TrainingReviewQueueItem], error) {
	return entity.Page[entity.TrainingReviewQueueItem]{Items: []entity.TrainingReviewQueueItem{}, Limit: 20}, nil
}

func (fakeModels) TrainingReadiness(context.Context, []string) (*entity.TrainingReadiness, error) {
	return &entity.TrainingReadiness{Ready: true}, nil
}

func (fakeModels) OverrideTrainingLabel(context.Context, entity.TrainingLabelOverride) error {
	return nil
}

func (fakeModels) StartTrainingJob(context.Context, entity.TrainingJobSpec) (*entity.TrainingJobResult, error) {
	return &entity.TrainingJobResult{
		JobID:  "train-test-1",
		Task:   "candidate_vetting",
		Status: "queued",
	}, nil
}

func (fakeModels) SetModelDeployment(context.Context, string, string, bool, string) (*entity.ModelDeploymentResult, error) {
	return &entity.ModelDeploymentResult{}, nil
}

type fakeInference struct{}

func (fakeInference) ListJobs(context.Context, string, string) ([]entity.InferenceJob, error) {
	return []entity.InferenceJob{}, nil
}
func (fakeInference) RetryJob(context.Context, string) (entity.InferenceJobManifest, map[string]any, error) {
	return entity.InferenceJobManifest{}, nil, nil
}

type fakeModelNew struct{}

func (fakeModelNew) TrainingPreflight(context.Context, []string) (*entity.TrainingPreflight, error) {
	return &entity.TrainingPreflight{Tier: "EXPERIMENTAL"}, nil
}

func (fakeModelNew) ListTrainingSnapshots(context.Context, int) ([]entity.ModelTrainingSnapshot, error) {
	return []entity.ModelTrainingSnapshot{}, nil
}

func (fakeModelNew) StartTraining(context.Context, entity.StartTrainingSpec) (*entity.TrainingResult, error) {
	return &entity.TrainingResult{
		TicketID: "train-test-1",
		Task:     "candidate_vetting",
		Status:   "queued",
	}, nil
}

func (fakeModelNew) ControlTraining(context.Context, entity.TrainingControlSpec) (*entity.TrainingControlResult, error) {
	return &entity.TrainingControlResult{
		TicketID: "RUN-TEST-001",
		Action:   "cancel",
		Status:   "dispatched",
	}, nil
}

type fakeReadiness struct{}

func (fakeReadiness) Check(context.Context) (map[string]string, bool) {
	return map[string]string{"storage_minio": "UP", "query_engine": "UP"}, true
}

type fakeMonitoring struct{}

func (fakeMonitoring) Query(context.Context, entity.MonitoringWindow, string) ([]entity.MonitoringComponent, error) {
	return []entity.MonitoringComponent{}, nil
}

type fakePreprocessing struct{}

func (fakePreprocessing) GetActiveJob(context.Context) (*entity.PreprocessingControlJob, error) {
	return nil, nil
}
func (fakePreprocessing) Start(context.Context, entity.PreprocessingStartRequest) (*entity.PreprocessingControlJob, error) {
	return &entity.PreprocessingControlJob{TicketID: "preprocess-job-test", Status: "running", Mode: "stream"}, nil
}
func (fakePreprocessing) Stop(context.Context, string) (*entity.PreprocessingControlJob, error) {
	return &entity.PreprocessingControlJob{TicketID: "preprocess-job-test", Status: "cancelling", Mode: "stream"}, nil
}

type fakeDAGAggregation struct{}

func (fakeDAGAggregation) QueryGraph(context.Context, string, string) (*entity.DAGGraph, error) {
	return &entity.DAGGraph{Status: "not_observed", Hops: []entity.DAGHop{}, Edges: []entity.DAGEdge{}}, nil
}
func (fakeDAGAggregation) AggregateHopMetrics(context.Context, string, string) (*entity.DAGHop, error) {
	return &entity.DAGHop{ID: "bronze", Label: "Bronze Ingestion"}, nil
}
func (fakeDAGAggregation) ObserveRuntime(entity.PreprocessingRuntimeEvent) {}

type fakeEnrichmentControl struct{}

func (fakeEnrichmentControl) GetControlOverview(context.Context) (*entity.EnrichmentControlOverview, error) {
	return &entity.EnrichmentControlOverview{Control: entity.EnrichmentControlState{Mode: "PAUSED", IdleFlushSeconds: 180}}, nil
}
func (fakeEnrichmentControl) Start(context.Context, entity.EnrichmentControlStartRequest) (*entity.EnrichmentCommandResult, error) {
	return &entity.EnrichmentCommandResult{Status: "armed", TicketID: "test-cmd"}, nil
}
func (fakeEnrichmentControl) Stop(context.Context) (*entity.EnrichmentCommandResult, error) {
	return &entity.EnrichmentCommandResult{Status: "pause_requested", TicketID: "test-cmd"}, nil
}
func (fakeEnrichmentControl) ListSnapshots(context.Context, int) ([]entity.EnrichmentSnapshotSummary, error) {
	return []entity.EnrichmentSnapshotSummary{{SnapshotID: "gold-v1-test", Status: "COMMITTED"}}, nil
}
func (fakeEnrichmentControl) Snapshot(_ context.Context, snapshotID string) (*entity.EnrichmentSnapshotDetail, error) {
	return &entity.EnrichmentSnapshotDetail{SnapshotID: snapshotID, Artifacts: []entity.EnrichmentArtifact{}}, nil
}

type fakeLineage struct{}

func (fakeLineage) TraceLineage(_ context.Context, inputs []entity.LineageLookup) ([]entity.LineageResolution, error) {
	return make([]entity.LineageResolution, 0, len(inputs)), nil
}

func (fakeLineage) GetLedger(_ context.Context, query entity.LineageLedgerQuery) (*entity.LineageLedgerResponse, error) {
	return &entity.LineageLedgerResponse{
		Items:     []entity.LineageRecord{},
		Inventory: entity.LineageInventory{},
		Total:     0,
		Page:      query.Page,
		PageSize:  query.PageSize,
	}, nil
}

type fakeIngest struct{}

func (fakeIngest) Status(context.Context) (*entity.IngestStatus, error) {
	return &entity.IngestStatus{Observed: false, Status: "not_observed"}, nil
}

func (fakeIngest) Storage(context.Context, string, string, int) (*entity.StorageListing, error) {
	return &entity.StorageListing{Bucket: "aurora", Prefix: "bronze/", Objects: []entity.StorageObject{}}, nil
}

type fakeLakehouse struct{}

func (fakeLakehouse) List(context.Context, entity.LakehouseListingQuery) (*entity.LakehouseListing, error) {
	return &entity.LakehouseListing{Bucket: "aurora", Prefix: "bronze/", Objects: []entity.LakehouseObject{}}, nil
}

func (fakeLakehouse) Preview(context.Context, entity.LakehousePreviewQuery) (*entity.LakehousePreviewResponse, error) {
	return &entity.LakehousePreviewResponse{Key: "test.txt", Format: "text", TextContent: "hello"}, nil
}

func (fakeIngest) Start(context.Context, entity.IngestStartRequest) (*entity.IngestControlJob, error) {
	return &entity.IngestControlJob{TicketID: "ingest-job-test", Status: "running"}, nil
}

func (fakeIngest) Cancel(context.Context, string) (*entity.IngestControlJob, error) {
	return &entity.IngestControlJob{TicketID: "ingest-job-test", Status: "draining"}, nil
}

type fakeTicket struct{}

func (fakeTicket) ListTickets(context.Context, int) ([]entity.RunnerTicket, error) {
	return []entity.RunnerTicket{}, nil
}
func (fakeTicket) CreateTicket(context.Context, string, string) (*entity.RunnerTicket, error) {
	return &entity.RunnerTicket{TicketID: "ticket-test"}, nil
}
func (fakeTicket) ListRuns(context.Context, string, int) ([]entity.PipelineRun, error) {
	return []entity.PipelineRun{}, nil
}
func (fakeTicket) Detail(context.Context, string) (*entity.PipelineRunDetail, error) {
	return &entity.PipelineRunDetail{Run: entity.PipelineRun{RunID: "run-test"}}, nil
}

var _ service.Candidate = fakeCandidate{}
var _ service.Anomaly = fakeAnomaly{}
var _ service.Target = fakeTarget{}
var _ service.Lakehouse = fakeLakehouse{}
var _ service.EnrichmentControl = fakeEnrichmentControl{}
var _ service.Ticket = fakeTicket{}

func newTestRouter() http.Handler {
	return app.NewRouter(&config.Config{
		CORSAllowedOrigin: "http://localhost:8501",
	}, &app.Module{
		TargetHandler:            handler.NewTargetHandler(fakeTarget{}),
		CandidateHandler:         handler.NewCandidateHandler(fakeCandidate{}),
		AnomalyHandler:           handler.NewAnomalyHandler(fakeAnomaly{}),
		ModelsHandler:            handler.NewModelsHandler(fakeModels{}, fakeInference{}),
		ModelNewHandler:          handler.NewModelNewHandler(fakeModelNew{}),
		SystemHandler:            handler.NewSystemHandler(fakeReadiness{}),
		MonitoringHandler:        handler.NewMonitoringHandler(fakeMonitoring{}),
		DAGAggregationHandler:    handler.NewDAGAggregationHandler(fakeDAGAggregation{}),
		PreprocessingHandler:     handler.NewPreprocessingHandler(fakePreprocessing{}),
		EnrichmentControlHandler: handler.NewEnrichmentControlHandler(fakeEnrichmentControl{}),
		LineageHandler:           handler.NewLineageHandler(fakeLineage{}),
		TicketHandler:            handler.NewTicketHandler(fakeTicket{}),
		IngestHandler:            handler.NewIngestHandler(fakeIngest{}),
		LakehouseHandler:         handler.NewLakehouseHandler(fakeLakehouse{}),
		EventsHandler:            handler.NewEventsHandler(provider.NewSSEBroker()),
	}, provider.NewMetrics())
}

func TestRouterEndpoints(t *testing.T) {
	router := newTestRouter()
	for _, endpoint := range []string{"/healthz", "/api/v1/system", "/api/v1/monitoring?tab=go-api", "/api/v1/dag/hops/bronze", "/api/v1/dag/hops/gold-pairing", "/api/v1/dag/hops/gold-commit", "/api/v1/dag/graph", "/api/v1/dag/graph?stage=enrichment", "/api/v1/dag/graph?stage=preprocessing", "/api/v1/data-factory/runs", "/api/v1/data-factory/tickets", "/api/v1/enrichment/control", "/api/v1/enrichment/snapshots", "/api/v1/enrichment/snapshots/gold-v1-test", "/api/v1/lineage/ledger", "/api/v1/ingest/status", "/api/v1/storage?prefix=bronze/&limit=10", "/api/v1/lakehouse/objects?prefix=bronze/&limit=10", "/api/v1/lakehouse/preview?key=test.txt", "/api/v1/targets", "/api/v1/targets/101?sector=42", "/api/v1/candidates?snapshot_id=gold-v1-test", "/api/v1/candidates/prediction-v1?snapshot_id=gold-v1-test", "/api/v1/lightcurves?tic_id=101&sector=42", "/api/v1/models/training-cohort/review-queue?snapshot_id=gold-v1-test", "/api/v1/models/training-preflight?snapshot_id=gold-v1-test", "/api/v1/models/snapshots"} {
		req := httptest.NewRequest(http.MethodGet, endpoint, nil)
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, req)
		if recorder.Code != http.StatusOK {
			t.Errorf("endpoint %s returned HTTP %d, expected 200", endpoint, recorder.Code)
		}
		if recorder.Header().Get("Content-Type") != "application/json; charset=utf-8" {
			t.Errorf("endpoint %s missing JSON content-type header", endpoint)
		}
	}
}

func TestEnrichmentControlStartAndStop(t *testing.T) {
	router := newTestRouter()
	query := httptest.NewRequest(http.MethodGet, "/api/v1/enrichment/control", nil)
	queryRecorder := httptest.NewRecorder()
	router.ServeHTTP(queryRecorder, query)
	if queryRecorder.Code != http.StatusOK {
		t.Fatalf("enrichment query returned HTTP %d", queryRecorder.Code)
	}

	start := httptest.NewRequest(http.MethodPost, "/api/v1/enrichment/control/start", strings.NewReader(`{"mode":"batch","max_batch_records":1000,"idle_flush_seconds":120,"ticket_id":"test-ticket"}`))
	start.Header.Set("Content-Type", "application/json")
	startRecorder := httptest.NewRecorder()
	router.ServeHTTP(startRecorder, start)
	if startRecorder.Code != http.StatusAccepted {
		t.Fatalf("enrichment start returned HTTP %d", startRecorder.Code)
	}

	stop := httptest.NewRequest(http.MethodPost, "/api/v1/enrichment/control/stop", nil)
	stopRecorder := httptest.NewRecorder()
	router.ServeHTTP(stopRecorder, stop)
	if stopRecorder.Code != http.StatusAccepted {
		t.Fatalf("enrichment stop returned HTTP %d", stopRecorder.Code)
	}

	// Validation rejection: invalid mode
	badMode := httptest.NewRequest(http.MethodPost, "/api/v1/enrichment/control/start", strings.NewReader(`{"mode":"invalid_mode"}`))
	badMode.Header.Set("Content-Type", "application/json")
	badModeRecorder := httptest.NewRecorder()
	router.ServeHTTP(badModeRecorder, badMode)
	if badModeRecorder.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request for invalid mode, got %d", badModeRecorder.Code)
	}

	// Validation rejection: idle flush out of range
	badFlush := httptest.NewRequest(http.MethodPost, "/api/v1/enrichment/control/start", strings.NewReader(`{"mode":"stream","idle_flush_seconds":10,"max_batch_records":5000}`))
	badFlush.Header.Set("Content-Type", "application/json")
	badFlushRecorder := httptest.NewRecorder()
	router.ServeHTTP(badFlushRecorder, badFlush)
	if badFlushRecorder.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request for invalid idle flush, got %d", badFlushRecorder.Code)
	}

	// Validation rejection: batch size out of range
	badBatch := httptest.NewRequest(http.MethodPost, "/api/v1/enrichment/control/start", strings.NewReader(`{"mode":"stream","idle_flush_seconds":180,"max_batch_records":0}`))
	badBatch.Header.Set("Content-Type", "application/json")
	badBatchRecorder := httptest.NewRecorder()
	router.ServeHTTP(badBatchRecorder, badBatch)
	if badBatchRecorder.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request for invalid batch size, got %d", badBatchRecorder.Code)
	}

	// Validation rejection: ticket_id too long
	longTicket := strings.Repeat("A", 129)
	badTicket := httptest.NewRequest(http.MethodPost, "/api/v1/enrichment/control/start", strings.NewReader(fmt.Sprintf(`{"mode":"stream","idle_flush_seconds":180,"max_batch_records":5000,"ticket_id":%q}`, longTicket)))
	badTicket.Header.Set("Content-Type", "application/json")
	badTicketRecorder := httptest.NewRecorder()
	router.ServeHTTP(badTicketRecorder, badTicket)
	if badTicketRecorder.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request for too long ticket_id, got %d", badTicketRecorder.Code)
	}

	// Validation rejection: missing ticket_id
	emptyTicket := httptest.NewRequest(http.MethodPost, "/api/v1/enrichment/control/start", strings.NewReader(`{"mode":"stream","idle_flush_seconds":180,"max_batch_records":5000}`))
	emptyTicket.Header.Set("Content-Type", "application/json")
	emptyTicketRecorder := httptest.NewRecorder()
	router.ServeHTTP(emptyTicketRecorder, emptyTicket)
	if emptyTicketRecorder.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request for missing ticket_id, got %d", emptyTicketRecorder.Code)
	}
}

func TestCandidateDetailExposesSeparatePhysicsAndMLAssessments(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/candidates/prediction-v1?snapshot_id=gold-v1-test", nil)
	recorder := httptest.NewRecorder()
	newTestRouter().ServeHTTP(recorder, req)
	if recorder.Code != http.StatusOK {
		t.Fatalf("candidate detail returned HTTP %d", recorder.Code)
	}
	var payload map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode candidate detail: %v", err)
	}
	if _, ok := payload["planet_physics"].(map[string]any); !ok {
		t.Fatal("candidate detail is missing planet_physics")
	}
	habitability, ok := payload["habitability"].(map[string]any)
	if !ok {
		t.Fatal("candidate detail is missing habitability")
	}
	if value, exists := habitability["ml_score"]; !exists || value != nil {
		t.Fatalf("unreleased ML score must be present as null, got %#v", value)
	}
}

func TestCandidateScientificReviewRoute(t *testing.T) {
	req := httptest.NewRequest(
		http.MethodPut,
		"/api/v1/candidates/prediction-v1/review",
		strings.NewReader(`{"snapshot_id":"gold-v1-test","decision":"CONFIRMED","note":"Periodic transit evidence survives vetting."}`),
	)
	req.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	newTestRouter().ServeHTTP(recorder, req)
	if recorder.Code != http.StatusOK {
		t.Fatalf("candidate review returned HTTP %d: %s", recorder.Code, recorder.Body.String())
	}
	var payload struct {
		Status string `json:"status"`
		Review struct {
			Decision string `json:"decision"`
			Reviewer string `json:"reviewer"`
		} `json:"review"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode candidate review response: %v", err)
	}
	if payload.Status != "reviewed" || payload.Review.Decision != "CONFIRMED" || payload.Review.Reviewer != "HUMAN_OPERATOR" {
		t.Fatalf("unexpected candidate review response: %#v", payload)
	}
}

func TestMonitoringTabValidation(t *testing.T) {
	// Rejects invalid component / tab
	req := httptest.NewRequest(http.MethodGet, "/api/v1/monitoring?component=not-a-component", nil)
	recorder := httptest.NewRecorder()
	newTestRouter().ServeHTTP(recorder, req)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("monitoring endpoint returned HTTP %d, expected 400", recorder.Code)
	}

	// Accepts valid component and returns component field without silly source: prometheus
	reqValid := httptest.NewRequest(http.MethodGet, "/api/v1/monitoring?component=go-api", nil)
	recorderValid := httptest.NewRecorder()
	newTestRouter().ServeHTTP(recorderValid, reqValid)
	if recorderValid.Code != http.StatusOK {
		t.Fatalf("monitoring endpoint returned HTTP %d, expected 200: %s", recorderValid.Code, recorderValid.Body.String())
	}
	var resp map[string]any
	if err := json.Unmarshal(recorderValid.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal monitoring response: %v", err)
	}
	if _, hasSource := resp["source"]; hasSource {
		t.Fatalf("monitoring response must not contain source field, got %#v", resp["source"])
	}
	if resp["component"] != "go-api" {
		t.Fatalf("expected component 'go-api', got %#v", resp["component"])
	}
}

func TestPreprocessingStart(t *testing.T) {
	// Missing ticket_id must fail with 400
	reqMissing := httptest.NewRequest(http.MethodPost, "/api/v1/preprocessing/tickets", strings.NewReader(`{"mode":"batch","worker_count":2}`))
	reqMissing.Header.Set("Content-Type", "application/json")
	recMissing := httptest.NewRecorder()
	newTestRouter().ServeHTTP(recMissing, reqMissing)
	if recMissing.Code != http.StatusBadRequest {
		t.Fatalf("preprocessing start without ticket_id returned HTTP %d, expected 400", recMissing.Code)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/preprocessing/tickets", strings.NewReader(`{"ticket_id":"preprocess-job-test","mode":"batch","worker_count":2}`))
	req.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	newTestRouter().ServeHTTP(recorder, req)
	if recorder.Code != http.StatusAccepted {
		t.Fatalf("preprocessing start returned HTTP %d, expected 202", recorder.Code)
	}
}

func TestPreprocessingStop(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/v1/preprocessing/tickets/preprocess-job-test/stop", nil)
	recorder := httptest.NewRecorder()
	newTestRouter().ServeHTTP(recorder, req)
	if recorder.Code != http.StatusAccepted {
		t.Fatalf("preprocessing stop returned HTTP %d, expected 202", recorder.Code)
	}
}

func TestRetiredAnomalyRoutesAreNotExposed(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/anomalies", nil)
	recorder := httptest.NewRecorder()
	newTestRouter().ServeHTTP(recorder, req)
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("retired anomaly endpoint returned HTTP %d, expected 404", recorder.Code)
	}
}

func TestCORSHeaders(t *testing.T) {
	req := httptest.NewRequest(http.MethodOptions, "/api/v1/candidates", nil)
	req.Header.Set("Origin", "http://localhost:8501")
	recorder := httptest.NewRecorder()
	newTestRouter().ServeHTTP(recorder, req)
	if recorder.Code != http.StatusOK || recorder.Header().Get("Access-Control-Allow-Origin") != "http://localhost:8501" {
		t.Fatalf("CORS headers were not applied")
	}
}

func TestLineageTraceRoute(t *testing.T) {
	router := newTestRouter()

	// 1. Direct slice format []LineageLookup
	reqDirect := httptest.NewRequest(http.MethodPost, "/api/v1/lineage/trace", strings.NewReader(`[{"source_product_id":"source-1"}]`))
	reqDirect.Header.Set("Content-Type", "application/json")
	recDirect := httptest.NewRecorder()
	router.ServeHTTP(recDirect, reqDirect)
	if recDirect.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for direct slice, got %d", recDirect.Code)
	}

	// 2. Wrapped object format {"inputs": [...]} is rejected without backward compatibility hack
	req := httptest.NewRequest(http.MethodPost, "/api/v1/lineage/trace", strings.NewReader(`{"inputs":[{"source_product_id":"source-1"}]}`))
	req.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, req)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request for wrapped object, got %d", recorder.Code)
	}

	// Verify legacy route is removed and returns 404
	legacyReq := httptest.NewRequest(http.MethodPost, "/api/v1/enrichment/lineage/resolve", strings.NewReader(`{"inputs":[{"source_product_id":"source-1"}]}`))
	legacyReq.Header.Set("Content-Type", "application/json")
	legacyRecorder := httptest.NewRecorder()
	router.ServeHTTP(legacyRecorder, legacyReq)
	if legacyRecorder.Code != http.StatusNotFound {
		t.Fatalf("expected 404 Not Found for removed legacy route, got %d", legacyRecorder.Code)
	}
}

func TestModelTrainingControlRoute(t *testing.T) {
	router := newTestRouter()

	// 1. Valid control request with ticket_id and action
	req := httptest.NewRequest(http.MethodPost, "/api/v1/models/train/control", strings.NewReader(`{"ticket_id":"RUN-20260921-0001","action":"cancel"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for valid control request, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp["ticket_id"] != "RUN-TEST-001" || resp["status"] != "dispatched" {
		t.Fatalf("unexpected response payload: %+v", resp)
	}

	// 2. Reject legacy job_id without ticket_id
	reqLegacy := httptest.NewRequest(http.MethodPost, "/api/v1/models/train/control", strings.NewReader(`{"job_id":"train-job-001","action":"cancel"}`))
	reqLegacy.Header.Set("Content-Type", "application/json")
	recLegacy := httptest.NewRecorder()
	router.ServeHTTP(recLegacy, reqLegacy)
	if recLegacy.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request for legacy payload without ticket_id, got %d", recLegacy.Code)
	}
}
