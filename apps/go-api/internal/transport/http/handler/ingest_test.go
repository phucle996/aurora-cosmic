package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"go-api/internal/domain/entity"

	"github.com/gin-gonic/gin"
)

type ingestHTTPStub struct{ started entity.IngestStartRequest }

func (s *ingestHTTPStub) Status(context.Context) (*entity.IngestStatus, error) {
	return &entity.IngestStatus{
		Observed:          true,
		Source:            "minio-checkpoint",
		RunID:             "ingest-run-1",
		ControlJobID:      "ingest-job-1",
		Status:            "running",
		CompletedProducts: 3,
		TotalProducts:     10,
		CompletedBytes:    42,
		Products: []entity.IngestProduct{{
			ID: "product-1", ObjectKey: "bronze/tess/lc.fits", Expected: 100, UpdatedAt: time.Date(2026, 8, 25, 5, 0, 0, 0, time.UTC),
		}},
	}, nil
}

func (*ingestHTTPStub) Storage(context.Context, string, int, int) (*entity.StorageListing, error) {
	return &entity.StorageListing{}, nil
}

func (s *ingestHTTPStub) Start(_ context.Context, request entity.IngestStartRequest) (*entity.IngestControlJob, error) {
	s.started = request
	return &entity.IngestControlJob{JobID: "ingest-job-1", Status: "running", ManifestPath: request.ManifestPath, Sector: request.Sector, Concurrency: request.Concurrency}, nil
}

func (*ingestHTTPStub) Cancel(context.Context, string) (*entity.IngestControlJob, error) {
	return &entity.IngestControlJob{JobID: "ingest-job-1", Status: "cancelling"}, nil
}

func TestIngestHTTPContractUsesSnakeCaseDTOs(t *testing.T) {
	gin.SetMode(gin.TestMode)
	stub := &ingestHTTPStub{}
	h := NewIngestHandler(stub)
	router := gin.New()
	router.GET("/status", h.Status)
	router.POST("/jobs", h.Start)

	statusRecorder := httptest.NewRecorder()
	router.ServeHTTP(statusRecorder, httptest.NewRequest(http.MethodGet, "/status?products_limit=1", nil))
	if statusRecorder.Code != http.StatusOK {
		t.Fatalf("status response = %d", statusRecorder.Code)
	}
	var status map[string]any
	if err := json.Unmarshal(statusRecorder.Body.Bytes(), &status); err != nil {
		t.Fatalf("decode status: %v", err)
	}
	if status["control_job_id"] != "ingest-job-1" || status["completed_products"] != float64(3) || status["CompletedProducts"] != nil {
		t.Fatalf("status response does not match the dashboard contract: %s", statusRecorder.Body.String())
	}

	startRecorder := httptest.NewRecorder()
	startRequest := httptest.NewRequest(http.MethodPost, "/jobs", strings.NewReader(`{"sector":42,"concurrency":8,"fresh":true}`))
	startRequest.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(startRecorder, startRequest)
	if startRecorder.Code != http.StatusAccepted {
		t.Fatalf("start response = %d: %s", startRecorder.Code, startRecorder.Body.String())
	}
	if stub.started.Sector != 42 || stub.started.Concurrency != 8 || !stub.started.Fresh {
		t.Fatalf("request DTO did not map to the entity: %#v", stub.started)
	}
	if !strings.Contains(startRecorder.Body.String(), `"job_id":"ingest-job-1"`) {
		t.Fatalf("control response does not use snake_case: %s", startRecorder.Body.String())
	}
}
