package ingester

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"go-api/internal/domain/entity"
)

func TestClientUsesSnakeCaseIngestControlContract(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/ingest/jobs" {
			t.Fatalf("path = %s", r.URL.Path)
		}
		if r.Method != http.MethodPost {
			t.Fatalf("method = %s", r.Method)
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatalf("read request body: %v", err)
		}
		if !strings.Contains(string(body), `"manifest_path":"remote:tess/sector=1/limit=all"`) {
			t.Fatalf("request does not use the ingest JSON contract: %s", body)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"job_id":"ingest-job-live","status":"running","manifest_path":"remote:tess/sector=1/limit=all","sector":1,"concurrency":8,"started_at":"2026-08-25T05:04:09Z","updated_at":"2026-08-25T05:04:10Z"}`))
	}))
	defer server.Close()

	job, err := NewClient(server.URL).Start(context.Background(), entity.IngestStartRequest{
		ManifestPath: "remote:tess/sector=1/limit=all",
		Sector:       1,
		Concurrency:  8,
	})
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	if job.JobID != "ingest-job-live" || job.ManifestPath == "" || job.Concurrency != 8 {
		t.Fatalf("snake_case control response was not decoded: %#v", job)
	}
}
