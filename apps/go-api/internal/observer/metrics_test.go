package observer

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestMetricsExposeBoundedHTTPSignals(t *testing.T) {
	metrics := New()
	metrics.RequestStarted()
	metrics.ObserveRequest(http.MethodGet, "/api/v1/inference/jobs/:job_id/retry", http.StatusBadGateway, 25*time.Millisecond)
	metrics.RequestFinished()

	recorder := httptest.NewRecorder()
	metrics.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	body, err := io.ReadAll(recorder.Result().Body)
	if err != nil {
		t.Fatalf("read metrics: %v", err)
	}
	text := string(body)
	for _, name := range []string{
		"aurora_api_http_requests_total",
		"aurora_api_http_request_duration_seconds",
		"aurora_api_http_errors_total",
		"aurora_api_http_inflight_requests",
		"aurora_api_start_time_seconds",
		"aurora_api_build_info",
	} {
		if !strings.Contains(text, name) {
			t.Errorf("metrics output missing %s", name)
		}
	}
	if !strings.Contains(text, `route="/api/v1/inference/jobs/:job_id/retry"`) {
		t.Fatal("metrics did not use the route template")
	}
	if strings.Contains(text, "inference-job-v1-") {
		t.Fatal("metrics exposed a high-cardinality job ID")
	}
}

func TestMetricsRejectInvalidStatusWithoutPanicking(t *testing.T) {
	metrics := New()
	metrics.ObserveRequest("", "", 0, 0)
}
