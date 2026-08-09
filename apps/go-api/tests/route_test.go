package tests

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"go-api/internal/app"
	"go-api/internal/config"
	"go-api/internal/domain/entity"
	"go-api/internal/domain/service"
	"go-api/internal/http/handler"
	"go-api/internal/observer"
)

type fakeAnalytics struct{}

func (fakeAnalytics) ListCandidates(context.Context, int, string, entity.PageRequest) (entity.Page[entity.Candidate], error) {
	return entity.Page[entity.Candidate]{Items: []entity.Candidate{}, Limit: 100}, nil
}
func (fakeAnalytics) GetCandidate(context.Context, string, string) (*entity.CandidateDetail, error) {
	return &entity.CandidateDetail{}, nil
}
func (fakeAnalytics) ListAnomalies(context.Context, int, string, bool, entity.PageRequest) (entity.Page[entity.Anomaly], error) {
	return entity.Page[entity.Anomaly]{Items: []entity.Anomaly{}, Limit: 100}, nil
}
func (fakeAnalytics) ListTargets(context.Context, entity.TargetQuery) (entity.Page[entity.Target], error) {
	return entity.Page[entity.Target]{Items: []entity.Target{}, Limit: 100}, nil
}
func (fakeAnalytics) GetTarget(context.Context, int64, int) (*entity.TargetDetail, error) {
	return &entity.TargetDetail{}, nil
}
func (fakeAnalytics) GetLightcurve(context.Context, int64, int, entity.PageRequest) (*entity.Lightcurve, error) {
	return &entity.Lightcurve{TICID: 101, Time: []float64{}, Flux: []float64{}}, nil
}

type fakeModels struct{}

func (fakeModels) ListModels(context.Context, string) ([]entity.Model, error) {
	return []entity.Model{}, nil
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

type fakeIngest struct{}

func (fakeIngest) Status(context.Context) (*entity.IngestStatus, error) {
	return &entity.IngestStatus{Observed: false, Source: "minio-checkpoint", Status: "not_observed"}, nil
}

func (fakeIngest) Storage(context.Context, string, int, int) (*entity.StorageListing, error) {
	return &entity.StorageListing{Bucket: "aurora", Prefix: "bronze/", Objects: []entity.StorageObject{}}, nil
}

func (fakeIngest) Start(context.Context, entity.IngestStartRequest) (*entity.IngestControlJob, error) {
	return &entity.IngestControlJob{JobID: "ingest-job-test", Status: "running"}, nil
}

func (fakeIngest) Cancel(context.Context, string) (*entity.IngestControlJob, error) {
	return &entity.IngestControlJob{JobID: "ingest-job-test", Status: "cancelling"}, nil
}

var _ service.Analytics = fakeAnalytics{}

func newTestRouter() *app.Router {
	return app.NewRouter(&config.Config{
		CORSAllowedOrigin: "http://localhost:8501",
	}, &app.Module{
		AnalyticsHandler:     handler.NewAnalyticsHandler(fakeAnalytics{}),
		ModelsHandler:        handler.NewModelsHandler(fakeModels{}, fakeInference{}),
		SystemHandler:        handler.NewSystemHandler(fakeReadiness{}),
		MonitoringHandler:    handler.NewMonitoringHandler(fakeMonitoring{}),
		PreprocessingHandler: handler.NewPreprocessingHandler(fakePreprocessing{}),
		IngestHandler:        handler.NewIngestHandler(fakeIngest{}),
	}, observer.New())
}

func TestRouterEndpoints(t *testing.T) {
	router := newTestRouter()
	for _, endpoint := range []string{"/healthz", "/api/v1/system", "/api/v1/monitoring?tab=go-api", "/api/v1/preprocessing/graph", "/api/v1/ingest/status", "/api/v1/storage?prefix=bronze/&limit=10", "/api/v1/targets", "/api/v1/targets/101?sector=42", "/api/v1/candidates?snapshot_id=gold-v1-test", "/api/v1/candidates/prediction-v1?snapshot_id=gold-v1-test", "/api/v1/anomalies?snapshot_id=gold-v1-test", "/api/v1/lightcurves?tic_id=101&sector=42"} {
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

func TestMonitoringTabValidation(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/monitoring?tab=not-a-component", nil)
	recorder := httptest.NewRecorder()
	newTestRouter().ServeHTTP(recorder, req)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("monitoring endpoint returned HTTP %d, expected 400", recorder.Code)
	}
}

func TestPreprocessingStart(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/v1/preprocessing/jobs", strings.NewReader(`{"mode":"batch"}`))
	req.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	newTestRouter().ServeHTTP(recorder, req)
	if recorder.Code != http.StatusAccepted {
		t.Fatalf("preprocessing start returned HTTP %d, expected 202", recorder.Code)
	}
}

func TestSnapshotIsRequired(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/anomalies", nil)
	recorder := httptest.NewRecorder()
	newTestRouter().ServeHTTP(recorder, req)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("anomaly endpoint returned HTTP %d, expected 400", recorder.Code)
	}
}

func TestAnomalyFlagFilterValidation(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/anomalies?snapshot_id=gold-v1-test&only_flagged=maybe", nil)
	recorder := httptest.NewRecorder()
	newTestRouter().ServeHTTP(recorder, req)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("anomaly only_flagged filter returned HTTP %d, expected 400", recorder.Code)
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
