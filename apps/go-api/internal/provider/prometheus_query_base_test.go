package provider

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"go-api/infra/prometheus"
)

func TestPrometheusQueryBase_QueryRange_Success(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/query_range" {
			http.NotFound(w, r)
			return
		}
		if r.URL.Query().Get("query") != "up" {
			t.Errorf("expected query 'up', got %q", r.URL.Query().Get("query"))
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{
			"status": "success",
			"data": {
				"resultType": "matrix",
				"result": [
					{
						"metric": {"job": "aurora-go-api"},
						"values": [
							[1700000000, "1.5"],
							[1700000015, "2.5"]
						]
					}
				]
			}
		}`))
	}))
	defer ts.Close()

	client := prometheus.NewClient(ts.URL)
	queryBase := NewPrometheusQueryBase(client)

	points, err := queryBase.QueryRange(context.Background(), "up", time.Unix(1700000000, 0), time.Unix(1700000015, 0), 15*time.Second)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(points) != 2 {
		t.Fatalf("expected 2 points, got %d", len(points))
	}
	if points[0].Timestamp != 1700000000 || points[0].Value != 1.5 {
		t.Errorf("unexpected point 0: %+v", points[0])
	}
	if points[0].Labels["job"] != "aurora-go-api" {
		t.Errorf("unexpected label: %v", points[0].Labels)
	}
	if points[1].Timestamp != 1700000015 || points[1].Value != 2.5 {
		t.Errorf("unexpected point 1: %+v", points[1])
	}
}

func TestPrometheusQueryBase_QueryRange_EmptyResult(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{
			"status": "success",
			"data": {
				"resultType": "matrix",
				"result": []
			}
		}`))
	}))
	defer ts.Close()

	client := prometheus.NewClient(ts.URL)
	queryBase := NewPrometheusQueryBase(client)

	points, err := queryBase.QueryRange(context.Background(), "up", time.Now().Add(-time.Hour), time.Now(), time.Minute)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(points) != 0 {
		t.Fatalf("expected 0 points, got %d", len(points))
	}
}

func TestPrometheusQueryBase_QueryRange_MultipleSeriesError(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{
			"status": "success",
			"data": {
				"resultType": "matrix",
				"result": [
					{"metric": {"job": "a"}, "values": []},
					{"metric": {"job": "b"}, "values": []}
				]
			}
		}`))
	}))
	defer ts.Close()

	client := prometheus.NewClient(ts.URL)
	queryBase := NewPrometheusQueryBase(client)

	_, err := queryBase.QueryRange(context.Background(), "up", time.Now().Add(-time.Hour), time.Now(), time.Minute)
	if err == nil {
		t.Fatal("expected error for multiple series, got nil")
	}
}

func TestPrometheusQueryBase_QueryRange_PrometheusError(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{
			"status": "error",
			"errorType": "bad_data",
			"error": "syntax error in promql"
		}`))
	}))
	defer ts.Close()

	client := prometheus.NewClient(ts.URL)
	queryBase := NewPrometheusQueryBase(client)

	_, err := queryBase.QueryRange(context.Background(), "invalid(", time.Now().Add(-time.Hour), time.Now(), time.Minute)
	if err == nil {
		t.Fatal("expected error, got nil")
	}
}

func TestPrometheusQueryBase_QueryRange_ClientNil(t *testing.T) {
	queryBase := NewPrometheusQueryBase(nil)
	_, err := queryBase.QueryRange(context.Background(), "up", time.Now().Add(-time.Hour), time.Now(), time.Minute)
	if err == nil {
		t.Fatal("expected error for nil client, got nil")
	}
}
