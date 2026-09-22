package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"go-api/internal/domain/entity"
)

type labelingServiceStub struct {
	shouldErr       bool
	errToReturn     error
	mockedWorkspace *entity.LabelingCohortWorkspace
	mockedSnapshots []entity.LabelingSnapshotItem
	mockedDetail    *entity.LabelingTargetDetail
}

func (s *labelingServiceStub) ListSnapshots(_ context.Context, _ int) ([]entity.LabelingSnapshotItem, error) {
	if s.shouldErr {
		if s.errToReturn != nil {
			return nil, s.errToReturn
		}
		return nil, fmt.Errorf("database query error")
	}
	return s.mockedSnapshots, nil
}

func (s *labelingServiceStub) GetCohortWorkspace(_ context.Context, _ []string, _ entity.PageRequest) (*entity.LabelingCohortWorkspace, error) {
	if s.shouldErr {
		if s.errToReturn != nil {
			return nil, s.errToReturn
		}
		return nil, fmt.Errorf("unexpected database failure")
	}
	return s.mockedWorkspace, nil
}

func (s *labelingServiceStub) GetTargetEvidence(_ context.Context, _ string, _ string) (*entity.LabelingTargetDetail, error) {
	if s.shouldErr {
		if s.errToReturn != nil {
			return nil, s.errToReturn
		}
		return nil, fmt.Errorf("unexpected database failure")
	}
	return s.mockedDetail, nil
}

func (s *labelingServiceStub) SaveCohortLabel(_ context.Context, _ entity.SaveCohortLabelRequest) error {
	if s.shouldErr {
		if s.errToReturn != nil {
			return s.errToReturn
		}
		return fmt.Errorf("unexpected database failure")
	}
	return nil
}

func TestLabelingHandler_ListSnapshots(t *testing.T) {
	gin.SetMode(gin.TestMode)

	stub := &labelingServiceStub{
		mockedSnapshots: []entity.LabelingSnapshotItem{
			{
				SnapshotID:   "gold-v1-90ba082075c9",
				LastModified: "2026-09-19T23:55:27Z",
				SizeBytes:    16686,
				RowCount:     4,
			},
		},
	}
	router := gin.New()
	h := NewLabelingHandler(stub)
	router.GET("/api/v1/labeling/snapshots", h.ListSnapshots)

	// 200 OK default limit
	req := httptest.NewRequest(http.MethodGet, "/api/v1/labeling/snapshots", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp struct {
		Snapshots []entity.LabelingSnapshotItem `json:"snapshots"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal error: %v", err)
	}
	if len(resp.Snapshots) != 1 || resp.Snapshots[0].SnapshotID != "gold-v1-90ba082075c9" {
		t.Fatalf("unexpected snapshots: %+v", resp.Snapshots)
	}

	// 400 Bad Request on invalid limit
	req = httptest.NewRequest(http.MethodGet, "/api/v1/labeling/snapshots?limit=-1", nil)
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}

	// 500 Error
	stub.shouldErr = true
	req = httptest.NewRequest(http.MethodGet, "/api/v1/labeling/snapshots", nil)
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

func TestLabelingHandler_GetCohortWorkspace(t *testing.T) {
	gin.SetMode(gin.TestMode)

	stub := &labelingServiceStub{
		mockedWorkspace: &entity.LabelingCohortWorkspace{
			Disposition: &entity.LabelingCohortDisposition{
				TotalRows: 100,
			},
			Queue: entity.LabelingQueuePage{
				Items: []entity.LabelingQueueSummaryItem{
					{
						SnapshotID:      "gold-v1-s01",
						SourceProductID: "p1",
						TICID:           12345,
						Sector:          1,
					},
				},
				TotalCount: 1,
				Limit:      20,
				Offset:     0,
				HasMore:    false,
			},
		},
	}
	router := gin.New()
	h := NewLabelingHandler(stub)
	router.GET("/api/v1/labeling/workspace", h.GetCohortWorkspace)

	// Case 1: Success (200 OK)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/labeling/workspace?snapshot_id=gold-v1-s01&limit=20&offset=0", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp entity.LabelingCohortWorkspace
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}
	if resp.Disposition == nil || resp.Disposition.TotalRows != 100 {
		t.Fatalf("unexpected disposition total_rows: %+v", resp.Disposition)
	}
	if len(resp.Queue.Items) != 1 || resp.Queue.Items[0].TICID != 12345 {
		t.Fatalf("unexpected queue items: %+v", resp.Queue.Items)
	}

	// Validation tests - all validated strictly at the handler layer:
	validationCases := []struct {
		name string
		url  string
	}{
		{"missing snapshot_id", "/api/v1/labeling/workspace"},
		{"empty snapshot_id", "/api/v1/labeling/workspace?snapshot_id="},
		{"invalid snapshot_id prefix", "/api/v1/labeling/workspace?snapshot_id=silver-v1-s01"},
		{"snapshot_id contains slashes", "/api/v1/labeling/workspace?snapshot_id=gold-v1-s01/sub"},
		{"negative offset", "/api/v1/labeling/workspace?snapshot_id=gold-v1-s01&offset=-5"},
		{"non-integer offset", "/api/v1/labeling/workspace?snapshot_id=gold-v1-s01&offset=abc"},
	}

	for _, tc := range validationCases {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, tc.url, nil)
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, r)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("expected 400 for %s, got %d: %s", tc.name, rec.Code, rec.Body.String())
			}
		})
	}

	// Service / Repo error test (500 Internal Server Error)
	stub.shouldErr = true
	req = httptest.NewRequest(http.MethodGet, "/api/v1/labeling/workspace?snapshot_id=gold-v1-s01", nil)
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 for service error, got %d", w.Code)
	}
}

func TestLabelingHandler_GetTargetEvidence(t *testing.T) {
	gin.SetMode(gin.TestMode)

	stub := &labelingServiceStub{
		mockedDetail: &entity.LabelingTargetDetail{
			SnapshotID:      "gold-v1-s01",
			SourceProductID: "p1",
			TICID:           12345,
			Sector:          1,
			BLSPower:        21.0,
		},
	}
	router := gin.New()
	h := NewLabelingHandler(stub)
	router.GET("/api/v1/labeling/target-evidence", h.GetTargetEvidence)

	// 1. Success (200 OK)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/labeling/target-evidence?snapshot_id=gold-v1-s01&source_product_id=p1", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp entity.LabelingTargetDetail
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal error: %v", err)
	}
	if resp.TICID != 12345 || resp.BLSPower != 21.0 {
		t.Fatalf("unexpected detail: %+v", resp)
	}

	// 2. Validation tests (all handled strictly by Handler)
	validationCases := []struct {
		name string
		url  string
	}{
		{"missing snapshot_id", "/api/v1/labeling/target-evidence?source_product_id=p1"},
		{"empty snapshot_id", "/api/v1/labeling/target-evidence?snapshot_id=&source_product_id=p1"},
		{"invalid snapshot_id prefix", "/api/v1/labeling/target-evidence?snapshot_id=silver-v1-s01&source_product_id=p1"},
		{"snapshot_id contains slashes", "/api/v1/labeling/target-evidence?snapshot_id=gold-v1-s01/nested&source_product_id=p1"},
		{"missing source_product_id", "/api/v1/labeling/target-evidence?snapshot_id=gold-v1-s01"},
		{"empty source_product_id", "/api/v1/labeling/target-evidence?snapshot_id=gold-v1-s01&source_product_id="},
	}

	for _, tc := range validationCases {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, tc.url, nil)
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, r)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("expected 400 for %s, got %d: %s", tc.name, rec.Code, rec.Body.String())
			}
		})
	}

	// 3. Not Found (404 Not Found)
	stub.shouldErr = true
	stub.errToReturn = fmt.Errorf("target evidence not found for snapshot_id=gold-v1-s01")
	req = httptest.NewRequest(http.MethodGet, "/api/v1/labeling/target-evidence?snapshot_id=gold-v1-s01&source_product_id=p1", nil)
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for not found, got %d", w.Code)
	}

	// 4. Internal Error (500 Internal Server Error)
	stub.errToReturn = fmt.Errorf("database connection failed")
	req = httptest.NewRequest(http.MethodGet, "/api/v1/labeling/target-evidence?snapshot_id=gold-v1-s01&source_product_id=p1", nil)
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 for internal error, got %d", w.Code)
	}
}

func TestLabelingHandler_SaveCohortLabel(t *testing.T) {
	gin.SetMode(gin.TestMode)

	stub := &labelingServiceStub{}
	router := gin.New()
	h := NewLabelingHandler(stub)
	router.POST("/api/v1/labeling/cohort/labels", h.SaveCohortLabel)
	router.POST("/api/v1/models/training-cohort/labels", h.SaveCohortLabel)

	// 1. Success (200 OK)
	payload := `{"snapshot_id":"gold-v1-s01","source_product_id":"p1","training_label":"POSITIVE","review_reason":"clear dips","confidence":0.95}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/labeling/cohort/labels", strings.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	// 2. Also works via models route
	req = httptest.NewRequest(http.MethodPost, "/api/v1/models/training-cohort/labels", strings.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	// 3. Validation errors
	invalidCases := []struct {
		name    string
		payload string
	}{
		{"invalid json", `{invalid`},
		{"missing snapshot_id", `{"source_product_id":"p1","training_label":"POSITIVE"}`},
		{"invalid snapshot_id prefix", `{"snapshot_id":"bronze-s01","source_product_id":"p1","training_label":"POSITIVE"}`},
		{"missing source_product_id", `{"snapshot_id":"gold-v1-s01","source_product_id":"","training_label":"POSITIVE"}`},
		{"invalid training_label", `{"snapshot_id":"gold-v1-s01","source_product_id":"p1","training_label":"MAYBE"}`},
	}

	for _, tc := range invalidCases {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodPost, "/api/v1/labeling/cohort/labels", strings.NewReader(tc.payload))
			r.Header.Set("Content-Type", "application/json")
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, r)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("expected 400 for %s, got %d: %s", tc.name, rec.Code, rec.Body.String())
			}
		})
	}

	// 4. Server error (500)
	stub.shouldErr = true
	stub.errToReturn = fmt.Errorf("clickhouse insert failed")
	req = httptest.NewRequest(http.MethodPost, "/api/v1/labeling/cohort/labels", strings.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", w.Code, w.Body.String())
	}
}
