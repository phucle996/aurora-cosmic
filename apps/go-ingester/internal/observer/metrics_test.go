package observer

import (
	"io"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestMetricsExposeBoundedIngestionSignals(t *testing.T) {
	m := New()
	m.SetQueueDepth(3)
	m.ProductStarted()
	m.ProductFinished("success", 1.25, 1024)
	m.ProductStarted()
	m.ProductFinished("unexpected-status", 0.5, 12)

	req := httptest.NewRequest("GET", "/metrics", nil)
	res := httptest.NewRecorder()
	m.Handler().ServeHTTP(res, req)
	if res.Code != 200 {
		t.Fatalf("metrics handler status = %d, want 200", res.Code)
	}
	body, err := io.ReadAll(res.Result().Body)
	if err != nil {
		t.Fatalf("read metrics response: %v", err)
	}
	text := string(body)
	for _, metric := range []string{
		"aurora_ingester_products_total{status=\"success\"} 1",
		"aurora_ingester_products_total{status=\"failed\"} 1",
		"aurora_ingester_errors_total 1",
		"aurora_ingester_bytes_processed_total 1036",
		"aurora_ingester_queue_depth 3",
	} {
		if !strings.Contains(text, metric) {
			t.Errorf("metrics output missing %q\n%s", metric, text)
		}
	}
}
