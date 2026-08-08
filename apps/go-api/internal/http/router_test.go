package http

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRouterEndpoints(t *testing.T) {
	router := NewRouter(nil, nil)

	endpoints := []string{
		"/healthz",
		"/api/v1/system",
		"/api/v1/targets",
		"/api/v1/candidates",
		"/api/v1/anomalies",
		"/api/v1/lightcurves?tic_id=101",
	}

	for _, ep := range endpoints {
		req := httptest.NewRequest(http.MethodGet, ep, nil)
		rec := httptest.NewRecorder()

		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Errorf("endpoint %s returned HTTP %d, expected 200", ep, rec.Code)
		}
		if rec.Header().Get("Content-Type") != "application/json; charset=utf-8" {
			t.Errorf("endpoint %s missing json content-type header", ep)
		}
	}
}

func TestCORSHeaders(t *testing.T) {
	router := NewRouter(nil, nil)
	req := httptest.NewRequest(http.MethodOptions, "/api/v1/candidates", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("OPTIONS request returned HTTP %d, expected 200", rec.Code)
	}
	if rec.Header().Get("Access-Control-Allow-Origin") != "*" {
		t.Errorf("CORS header missing")
	}
}
