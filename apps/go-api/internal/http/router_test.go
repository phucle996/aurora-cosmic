package http

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"go-api/internal/store"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func newTestRouter(t *testing.T) *Router {
	t.Helper()
	clickHouse := store.NewClickHouseStore("http://clickhouse:8123", "aurora")
	clickHouse.Client.Transport = roundTripFunc(func(req *http.Request) (*http.Response, error) {
		query := req.URL.Query().Get("query")
		body := `{"data":[]}`
		switch {
		case strings.Contains(query, "candidate_predictions"):
			body = `{"data":[{"prediction_id":"candidate-1","source_product_id":"product-1","tic_id":101,"sector":10,"raw_logit":2.3,"candidate_score":0.9,"decision_threshold":0.5,"above_threshold":true,"model_version":"v1","runtime_package_id":"runtime-1"}]}`
		case strings.Contains(query, "anomaly_predictions"):
			body = `{"data":[{"prediction_id":"anomaly-1","source_product_id":"product-1","tic_id":101,"sector":10,"reconstruction_mse":0.2,"decision_threshold":0.1,"above_threshold":true,"model_version":"v1","runtime_package_id":"runtime-1"}]}`
		case strings.Contains(query, "FROM targets"):
			body = `{"data":[{"tic_id":101,"tess_mag":10.4,"ra":1.2,"dec":2.3,"effective_t":5800,"surface_grav":4.4,"radius":1.0,"sector":10,"matched_toi":"TOI-101","disposition":"CANDIDATE"}]}`
		case strings.Contains(query, "FROM lightcurves"):
			body = `{"data":[{"time":1.0,"flux":0.99}]}`
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(body)),
			Header:     make(http.Header),
			Request:    req,
		}, nil
	})
	return NewRouter(clickHouse, nil, "http://localhost:8501")
}

func TestRouterEndpoints(t *testing.T) {
	router := newTestRouter(t)

	endpoints := []string{
		"/healthz",
		"/api/v1/system",
		"/api/v1/targets",
		"/api/v1/candidates",
		"/api/v1/anomalies",
		"/api/v1/lightcurves?tic_id=101",
	}

	for _, endpoint := range endpoints {
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

func TestAnalyticalEndpointsFailClosedWithoutStore(t *testing.T) {
	router := NewRouter(nil, nil, "http://localhost:8501")
	request := httptest.NewRequest(http.MethodGet, "/api/v1/candidates", nil)
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("candidate endpoint returned HTTP %d, expected %d", recorder.Code, http.StatusServiceUnavailable)
	}
}

func TestCORSHeaders(t *testing.T) {
	router := newTestRouter(t)
	request := httptest.NewRequest(http.MethodOptions, "/api/v1/candidates", nil)
	request.Header.Set("Origin", "http://localhost:8501")
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Errorf("OPTIONS request returned HTTP %d, expected 200", recorder.Code)
	}
	if recorder.Header().Get("Access-Control-Allow-Origin") != "http://localhost:8501" {
		t.Errorf("expected configured CORS origin, got %q", recorder.Header().Get("Access-Control-Allow-Origin"))
	}
}
