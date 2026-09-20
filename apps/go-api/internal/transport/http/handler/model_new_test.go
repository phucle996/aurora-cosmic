package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"go-api/internal/domain/entity"
	"go-api/internal/taxonomy"
)

type fakeModelNewService struct {
	preflight   *entity.TrainingPreflight
	snapshots   []entity.ModelTrainingSnapshot
	training    *entity.TrainingResult
	control     *entity.TrainingControlResult
	activeState *entity.TrainingActiveState
	err         error
}

func (f *fakeModelNewService) TrainingPreflight(_ context.Context, _ []string) (*entity.TrainingPreflight, error) {
	return f.preflight, f.err
}

func (f *fakeModelNewService) ListTrainingSnapshots(_ context.Context, _ int) ([]entity.ModelTrainingSnapshot, error) {
	return f.snapshots, f.err
}

func (f *fakeModelNewService) StartTraining(_ context.Context, _ entity.StartTrainingSpec) (*entity.TrainingResult, error) {
	if f.training != nil {
		return f.training, f.err
	}
	return &entity.TrainingResult{Status: "queued"}, f.err
}

func (f *fakeModelNewService) ControlTraining(_ context.Context, spec entity.TrainingControlSpec) (*entity.TrainingControlResult, error) {
	if f.control != nil {
		return f.control, f.err
	}
	return &entity.TrainingControlResult{
		TicketID: spec.TicketID,
		Action:   spec.Action,
		Status:   "dispatched",
	}, f.err
}

func (f *fakeModelNewService) GetActiveTraining(_ context.Context, _ string) (*entity.TrainingActiveState, error) {
	return f.activeState, f.err
}

func (f *fakeModelNewService) ObserveTrainingProgress(_ context.Context, _ map[string]any) error {
	return f.err
}

func (f *fakeModelNewService) ObserveTrainingLog(_ context.Context, _ string, _ entity.TrainingLogEntry) error {
	return f.err
}

func TestModelNewHandler_TrainingPreflight(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("Missing snapshot_id returns 400", func(t *testing.T) {
		h := NewModelNewHandler(&fakeModelNewService{})
		router := gin.New()
		router.GET("/preflight", h.TrainingPreflight)

		req := httptest.NewRequest(http.MethodGet, "/preflight", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d", rec.Code)
		}
	})

	t.Run("Invalid snapshot_id prefix returns 400", func(t *testing.T) {
		h := NewModelNewHandler(&fakeModelNewService{})
		router := gin.New()
		router.GET("/preflight", h.TrainingPreflight)

		req := httptest.NewRequest(http.MethodGet, "/preflight?snapshot_id=invalid-prefix", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d", rec.Code)
		}
	})

	t.Run("Snapshot_id with slashes returns 400", func(t *testing.T) {
		h := NewModelNewHandler(&fakeModelNewService{})
		router := gin.New()
		router.GET("/preflight", h.TrainingPreflight)

		req := httptest.NewRequest(http.MethodGet, "/preflight?snapshot_id=gold-v1-test/sub", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d", rec.Code)
		}
	})

	t.Run("Exceeding max snapshots limit returns 400", func(t *testing.T) {
		h := NewModelNewHandler(&fakeModelNewService{})
		router := gin.New()
		router.GET("/preflight", h.TrainingPreflight)

		manyIDs := make([]string, 201)
		for i := 0; i < 201; i++ {
			manyIDs[i] = fmt.Sprintf("snapshot_id=gold-v1-%04d", i)
		}
		query := strings.Join(manyIDs, "&")

		req := httptest.NewRequest(http.MethodGet, "/preflight?"+query, nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 for max limit exceeded, got %d", rec.Code)
		}
	})

	t.Run("Invalid request from service returns 400", func(t *testing.T) {
		h := NewModelNewHandler(&fakeModelNewService{
			err: fmt.Errorf("%w: snapshot not found", taxonomy.ErrInvalidRequest),
		})
		router := gin.New()
		router.GET("/preflight", h.TrainingPreflight)

		req := httptest.NewRequest(http.MethodGet, "/preflight?snapshot_id=gold-v1-test", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d", rec.Code)
		}
	})

	t.Run("Storage failure from service returns 503", func(t *testing.T) {
		h := NewModelNewHandler(&fakeModelNewService{
			err: errors.New("clickhouse connection timeout"),
		})
		router := gin.New()
		router.GET("/preflight", h.TrainingPreflight)

		req := httptest.NewRequest(http.MethodGet, "/preflight?snapshot_id=gold-v1-test", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusServiceUnavailable {
			t.Fatalf("expected 503, got %d", rec.Code)
		}
	})

	t.Run("Valid request returns 200 with preflight report", func(t *testing.T) {
		expected := &entity.TrainingPreflight{
			SnapshotIDs:     []string{"gold-v1-test"},
			Tier:            "EXPERIMENTAL",
			PositiveTargets: 65,
			NegativeTargets: 62,
		}
		h := NewModelNewHandler(&fakeModelNewService{preflight: expected})
		router := gin.New()
		router.GET("/preflight", h.TrainingPreflight)

		req := httptest.NewRequest(http.MethodGet, "/preflight?snapshot_id=gold-v1-test", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", rec.Code)
		}

		var res entity.TrainingPreflight
		if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
			t.Fatalf("unmarshal response: %v", err)
		}
		if res.Tier != "EXPERIMENTAL" {
			t.Fatalf("expected Tier: EXPERIMENTAL, got Tier: %s", res.Tier)
		}
	})
}

func TestModelNewHandler_ListSnapshots(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("Invalid limit returns 400", func(t *testing.T) {
		h := NewModelNewHandler(&fakeModelNewService{})
		router := gin.New()
		router.GET("/snapshots", h.ListSnapshots)

		req := httptest.NewRequest(http.MethodGet, "/snapshots?limit=abc", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 for non-numeric limit, got %d", rec.Code)
		}
	})

	t.Run("Limit out of bounds returns 400", func(t *testing.T) {
		h := NewModelNewHandler(&fakeModelNewService{})
		router := gin.New()
		router.GET("/snapshots", h.ListSnapshots)

		req := httptest.NewRequest(http.MethodGet, "/snapshots?limit=500", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 for limit > 200, got %d", rec.Code)
		}
	})

	t.Run("Service error returns 503", func(t *testing.T) {
		h := NewModelNewHandler(&fakeModelNewService{err: errors.New("clickhouse down")})
		router := gin.New()
		router.GET("/snapshots", h.ListSnapshots)

		req := httptest.NewRequest(http.MethodGet, "/snapshots", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusServiceUnavailable {
			t.Fatalf("expected 503, got %d", rec.Code)
		}
	})

	t.Run("Valid request returns 200 with snapshots", func(t *testing.T) {
		expected := []entity.ModelTrainingSnapshot{
			{
				SnapshotID:     "gold-v1-test",
				Key:            "gold/snapshots/gold-v1-test/manifest.json",
				LastModified:   "2026-09-20T10:00:00Z",
				SizeBytes:      1024,
				CandidateCount: 20,
			},
		}
		h := NewModelNewHandler(&fakeModelNewService{snapshots: expected})
		router := gin.New()
		router.GET("/snapshots", h.ListSnapshots)

		req := httptest.NewRequest(http.MethodGet, "/snapshots?limit=50", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", rec.Code)
		}

		var res struct {
			Snapshots []entity.ModelTrainingSnapshot `json:"snapshots"`
			Total     int                            `json:"total"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
			t.Fatalf("unmarshal response: %v", err)
		}
		if res.Total != 1 || len(res.Snapshots) != 1 || res.Snapshots[0].SnapshotID != "gold-v1-test" {
			t.Fatalf("expected 1 snapshot, got %+v", res)
		}
	})
}

func TestModelNewHandler_ControlTraining(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("Malformed JSON returns 400", func(t *testing.T) {
		h := NewModelNewHandler(&fakeModelNewService{})
		router := gin.New()
		router.POST("/control", h.ControlTraining)

		req := httptest.NewRequest(http.MethodPost, "/control", strings.NewReader(`invalid-json`))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d", rec.Code)
		}
	})

	t.Run("Missing ticket_id returns 400", func(t *testing.T) {
		h := NewModelNewHandler(&fakeModelNewService{})
		router := gin.New()
		router.POST("/control", h.ControlTraining)

		req := httptest.NewRequest(http.MethodPost, "/control", strings.NewReader(`{"action":"cancel"}`))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d", rec.Code)
		}
	})

	t.Run("Invalid ticket_id pattern returns 400", func(t *testing.T) {
		h := NewModelNewHandler(&fakeModelNewService{})
		router := gin.New()
		router.POST("/control", h.ControlTraining)

		req := httptest.NewRequest(http.MethodPost, "/control", strings.NewReader(`{"ticket_id":"RUN/../../BAD","action":"cancel"}`))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d", rec.Code)
		}
	})

	t.Run("Invalid action returns 400", func(t *testing.T) {
		h := NewModelNewHandler(&fakeModelNewService{})
		router := gin.New()
		router.POST("/control", h.ControlTraining)

		req := httptest.NewRequest(http.MethodPost, "/control", strings.NewReader(`{"ticket_id":"RUN-20260921-0001","action":"destroy"}`))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d", rec.Code)
		}
	})

	t.Run("Valid cancel request returns 200 with dispatched status", func(t *testing.T) {
		h := NewModelNewHandler(&fakeModelNewService{})
		router := gin.New()
		router.POST("/control", h.ControlTraining)

		req := httptest.NewRequest(http.MethodPost, "/control", strings.NewReader(`{"ticket_id":"RUN-20260921-0001","action":"cancel"}`))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
		}

		var result entity.TrainingControlResult
		if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
			t.Fatalf("unmarshal response: %v", err)
		}
		if result.TicketID != "RUN-20260921-0001" || result.Action != "cancel" || result.Status != "dispatched" {
			t.Fatalf("unexpected control result: %+v", result)
		}
	})

	t.Run("Valid checkpoint request returns 200", func(t *testing.T) {
		h := NewModelNewHandler(&fakeModelNewService{})
		router := gin.New()
		router.POST("/control", h.ControlTraining)

		req := httptest.NewRequest(http.MethodPost, "/control", strings.NewReader(`{"ticket_id":"RUN-20260921-0001","action":"checkpoint"}`))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", rec.Code)
		}
	})

	t.Run("Service ErrInvalidRequest returns 400", func(t *testing.T) {
		h := NewModelNewHandler(&fakeModelNewService{err: fmt.Errorf("%w: invalid state", taxonomy.ErrInvalidRequest)})
		router := gin.New()
		router.POST("/control", h.ControlTraining)

		req := httptest.NewRequest(http.MethodPost, "/control", strings.NewReader(`{"ticket_id":"RUN-20260921-0001","action":"cancel"}`))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d", rec.Code)
		}
	})

	t.Run("Internal service error returns 503", func(t *testing.T) {
		h := NewModelNewHandler(&fakeModelNewService{err: errors.New("dispatcher unavailable")})
		router := gin.New()
		router.POST("/control", h.ControlTraining)

		req := httptest.NewRequest(http.MethodPost, "/control", strings.NewReader(`{"ticket_id":"RUN-20260921-0001","action":"cancel"}`))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusServiceUnavailable {
			t.Fatalf("expected 503, got %d", rec.Code)
		}
	})
}

func TestModelNewHandler_GetActiveTraining(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("Invalid ticket_id pattern returns 400", func(t *testing.T) {
		h := NewModelNewHandler(&fakeModelNewService{})
		router := gin.New()
		router.GET("/active", h.GetActiveTraining)

		req := httptest.NewRequest(http.MethodGet, "/active?ticket_id=bad$ticket!", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d", rec.Code)
		}
	})

	t.Run("No active run returns active: false", func(t *testing.T) {
		h := NewModelNewHandler(&fakeModelNewService{})
		router := gin.New()
		router.GET("/active", h.GetActiveTraining)

		req := httptest.NewRequest(http.MethodGet, "/active", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", rec.Code)
		}
		var body map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if body["active"] != false {
			t.Fatalf("expected active=false, got %v", body["active"])
		}
	})

	t.Run("Active run returns 200 with active state", func(t *testing.T) {
		h := NewModelNewHandler(&fakeModelNewService{
			activeState: &entity.TrainingActiveState{
				TicketID: "RUN-001",
				Status:   "running",
				Phase:    "training",
			},
		})
		router := gin.New()
		router.GET("/active", h.GetActiveTraining)

		req := httptest.NewRequest(http.MethodGet, "/active?ticket_id=RUN-001", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", rec.Code)
		}
		var body map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if body["active"] != true {
			t.Fatalf("expected active=true, got %v", body["active"])
		}
	})
}

