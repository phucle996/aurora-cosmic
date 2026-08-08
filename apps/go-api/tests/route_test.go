package tests

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"go-api/internal/app"
	"go-api/internal/config"
	"go-api/internal/domain/entity"
	"go-api/internal/domain/service"
	"go-api/internal/http/handler"
)

type fakeAnalytics struct{}

func (fakeAnalytics) ListCandidates(context.Context, int, string, entity.PageRequest) (entity.Page[entity.Candidate], error) {
	return entity.Page[entity.Candidate]{Items: []entity.Candidate{}, Limit: 100}, nil
}
func (fakeAnalytics) ListAnomalies(context.Context, int, string, entity.PageRequest) (entity.Page[entity.Anomaly], error) {
	return entity.Page[entity.Anomaly]{Items: []entity.Anomaly{}, Limit: 100}, nil
}
func (fakeAnalytics) ListTargets(context.Context, int, entity.PageRequest) (entity.Page[entity.Target], error) {
	return entity.Page[entity.Target]{Items: []entity.Target{}, Limit: 100}, nil
}
func (fakeAnalytics) GetLightcurve(context.Context, int64, entity.PageRequest) (*entity.Lightcurve, error) {
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

func (fakeMonitoring) Query(context.Context, entity.MonitoringWindow) ([]entity.MonitoringComponent, error) {
	return []entity.MonitoringComponent{}, nil
}

var _ service.Analytics = fakeAnalytics{}

func newTestRouter() *app.Router {
	return app.NewRouter(&config.Config{
		CORSAllowedOrigin: "http://localhost:8501",
	}, &app.Module{
		AnalyticsHandler:  handler.NewAnalyticsHandler(fakeAnalytics{}),
		ModelsHandler:     handler.NewModelsHandler(fakeModels{}, fakeInference{}),
		SystemHandler:     handler.NewSystemHandler(fakeReadiness{}),
		MonitoringHandler: handler.NewMonitoringHandler(fakeMonitoring{}),
	})
}

func TestRouterEndpoints(t *testing.T) {
	router := newTestRouter()
	for _, endpoint := range []string{"/healthz", "/api/v1/system", "/api/v1/targets", "/api/v1/candidates?snapshot_id=gold-v1-test", "/api/v1/anomalies?snapshot_id=gold-v1-test", "/api/v1/lightcurves?tic_id=101"} {
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

func TestSnapshotIsRequired(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/anomalies", nil)
	recorder := httptest.NewRecorder()
	newTestRouter().ServeHTTP(recorder, req)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("anomaly endpoint returned HTTP %d, expected 400", recorder.Code)
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
