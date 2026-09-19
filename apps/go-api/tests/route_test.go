package tests

import (
	"context"
	"encoding/json"
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

type fakeReadiness struct{}

func (fakeReadiness) Check(context.Context) (map[string]string, bool) {
	return map[string]string{"storage_minio": "UP", "query_engine": "UP"}, true
}

type fakeMonitoring struct{}

func (fakeMonitoring) Query(context.Context, entity.MonitoringWindow, string) ([]entity.MonitoringComponent, error) {
	return []entity.MonitoringComponent{}, nil
}

type fakePreprocessing struct{}

func (fakePreprocessing) Query(context.Context) (*entity.PreprocessingGraph, error) {
	return &entity.PreprocessingGraph{Source: "prometheus", Status: "not_observed", Hops: []entity.PreprocessingHop{}, Edges: []entity.PreprocessingEdge{}}, nil
}
func (fakePreprocessing) Start(context.Context, entity.PreprocessingStartRequest) (*entity.PreprocessingControlJob, error) {
	return &entity.PreprocessingControlJob{JobID: "preprocess-job-test", Status: "running", Mode: "stream"}, nil
}
func (fakePreprocessing) Stop(context.Context, string) (*entity.PreprocessingControlJob, error) {
	return &entity.PreprocessingControlJob{JobID: "preprocess-job-test", Status: "cancelling", Mode: "stream"}, nil
}
func (fakePreprocessing) ObserveRuntime(entity.PreprocessingRuntimeEvent) {}

type fakeGoldControl struct{}

func (fakeGoldControl) Query(context.Context) (*entity.GoldControlOverview, error) {
	return &entity.GoldControlOverview{Control: entity.GoldControlState{Mode: "PAUSED", IdleFlushSeconds: 180}}, nil
}
func (fakeGoldControl) Start(context.Context, entity.GoldControlStartRequest) (*entity.GoldControlOverview, error) {
	return &entity.GoldControlOverview{Control: entity.GoldControlState{Mode: "STREAM", IdleFlushSeconds: 180}}, nil
}
func (fakeGoldControl) Stop(context.Context) (*entity.GoldControlOverview, error) {
	return &entity.GoldControlOverview{Control: entity.GoldControlState{Mode: "PAUSED", IdleFlushSeconds: 180}}, nil
}
func (fakeGoldControl) ResolveLineage(_ context.Context, inputs []entity.GoldLineageLookup) ([]entity.GoldLineageResolution, error) {
	return make([]entity.GoldLineageResolution, 0, len(inputs)), nil
}
func (fakeGoldControl) ListSnapshots(context.Context, int) ([]entity.GoldSnapshotSummary, error) {
	return []entity.GoldSnapshotSummary{{SnapshotID: "gold-v1-test", Status: "COMMITTED"}}, nil
}
func (fakeGoldControl) Snapshot(_ context.Context, snapshotID string) (*entity.GoldSnapshotDetail, error) {
	return &entity.GoldSnapshotDetail{SnapshotID: snapshotID, Artifacts: []entity.GoldArtifact{}}, nil
}
func (fakeGoldControl) Artifact(_ context.Context, snapshotID, dataset string, sector int, _ entity.GoldArtifactPreviewQuery) (*entity.GoldArtifactDetail, error) {
	return &entity.GoldArtifactDetail{SnapshotID: snapshotID, Artifact: entity.GoldArtifact{Dataset: dataset, Sector: sector}}, nil
}

type fakeIngest struct{}

func (fakeIngest) Status(context.Context) (*entity.IngestStatus, error) {
	return &entity.IngestStatus{Observed: false, Status: "not_observed"}, nil
}

func (fakeIngest) Storage(context.Context, string, string, int) (*entity.StorageListing, error) {
	return &entity.StorageListing{Bucket: "aurora", Prefix: "bronze/", Objects: []entity.StorageObject{}}, nil
}

func (fakeIngest) Start(context.Context, entity.IngestStartRequest) (*entity.IngestControlJob, error) {
	return &entity.IngestControlJob{TicketID: "ingest-job-test", Status: "running"}, nil
}

func (fakeIngest) Cancel(context.Context, string) (*entity.IngestControlJob, error) {
	return &entity.IngestControlJob{TicketID: "ingest-job-test", Status: "draining"}, nil
}

var _ service.Candidate = fakeCandidate{}
var _ service.Anomaly = fakeAnomaly{}
var _ service.Target = fakeTarget{}

func newTestRouter() http.Handler {
	return app.NewRouter(&config.Config{
		CORSAllowedOrigin: "http://localhost:8501",
	}, &app.Module{
		TargetHandler:        handler.NewTargetHandler(fakeTarget{}),
		CandidateHandler:     handler.NewCandidateHandler(fakeCandidate{}),
		AnomalyHandler:       handler.NewAnomalyHandler(fakeAnomaly{}),
		ModelsHandler:        handler.NewModelsHandler(fakeModels{}, fakeInference{}),
		SystemHandler:        handler.NewSystemHandler(fakeReadiness{}),
		MonitoringHandler:    handler.NewMonitoringHandler(fakeMonitoring{}),
		PreprocessingHandler: handler.NewPreprocessingHandler(fakePreprocessing{}),
		GoldControlHandler:   handler.NewGoldControlHandler(fakeGoldControl{}),
		IngestHandler:        handler.NewIngestHandler(fakeIngest{}),
	}, provider.NewMetrics())
}

func TestRouterEndpoints(t *testing.T) {
	router := newTestRouter()
	for _, endpoint := range []string{"/healthz", "/api/v1/system", "/api/v1/monitoring?tab=go-api", "/api/v1/preprocessing/graph", "/api/v1/gold/control", "/api/v1/gold/snapshots", "/api/v1/gold/snapshots/gold-v1-test", "/api/v1/gold/snapshots/gold-v1-test/artifacts/candidate/42", "/api/v1/ingest/status", "/api/v1/storage?prefix=bronze/&limit=10", "/api/v1/targets", "/api/v1/targets/101?sector=42", "/api/v1/candidates?snapshot_id=gold-v1-test", "/api/v1/candidates/prediction-v1?snapshot_id=gold-v1-test", "/api/v1/lightcurves?tic_id=101&sector=42", "/api/v1/models/training-cohort/review-queue?snapshot_id=gold-v1-test"} {
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

func TestGoldControlStartAndStop(t *testing.T) {
	router := newTestRouter()
	start := httptest.NewRequest(http.MethodPost, "/api/v1/gold/control/start", strings.NewReader(`{"mode":"stream","idle_flush_seconds":180}`))
	start.Header.Set("Content-Type", "application/json")
	startRecorder := httptest.NewRecorder()
	router.ServeHTTP(startRecorder, start)
	if startRecorder.Code != http.StatusAccepted {
		t.Fatalf("gold start returned HTTP %d", startRecorder.Code)
	}
	stop := httptest.NewRequest(http.MethodPost, "/api/v1/gold/control/stop", nil)
	stopRecorder := httptest.NewRecorder()
	router.ServeHTTP(stopRecorder, stop)
	if stopRecorder.Code != http.StatusAccepted {
		t.Fatalf("gold stop returned HTTP %d", stopRecorder.Code)
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
	req := httptest.NewRequest(http.MethodPost, "/api/v1/preprocessing/jobs", strings.NewReader(`{"mode":"batch","worker_count":2}`))
	req.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	newTestRouter().ServeHTTP(recorder, req)
	if recorder.Code != http.StatusAccepted {
		t.Fatalf("preprocessing start returned HTTP %d, expected 202", recorder.Code)
	}
}

func TestPreprocessingStop(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/v1/preprocessing/jobs/preprocess-job-test/stop", nil)
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
