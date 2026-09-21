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
	"go-api/internal/provider"
	"go-api/internal/taxonomy"
)

type fakeModelService struct {
	preflight   *entity.TrainingPreflight
	snapshots   []entity.ModelTrainingSnapshot
	training    *entity.TrainingResult
	control     *entity.TrainingControlResult
	activeState *entity.TrainingActiveState
	models      []entity.Model
	evaluation  *entity.ModelEvaluation
	evolution   *entity.ModelEvolutionEvidence
	err         error
}

func (f *fakeModelService) TrainingPreflight(_ context.Context, _ []string) (*entity.TrainingPreflight, error) {
	return f.preflight, f.err
}

func (f *fakeModelService) ListTrainingSnapshots(_ context.Context, _ int) ([]entity.ModelTrainingSnapshot, error) {
	return f.snapshots, f.err
}

func (f *fakeModelService) StartTraining(_ context.Context, _ entity.StartTrainingSpec) (*entity.TrainingResult, error) {
	if f.training != nil {
		return f.training, f.err
	}
	return &entity.TrainingResult{Status: "queued"}, f.err
}

func (f *fakeModelService) ControlTraining(_ context.Context, spec entity.TrainingControlSpec) (*entity.TrainingControlResult, error) {
	if f.control != nil {
		return f.control, f.err
	}
	return &entity.TrainingControlResult{
		TicketID: spec.TicketID,
		Action:   spec.Action,
		Status:   "dispatched",
	}, f.err
}

func (f *fakeModelService) GetActiveTraining(_ context.Context, _ string) (*entity.TrainingActiveState, error) {
	return f.activeState, f.err
}

func (f *fakeModelService) ObserveTrainingProgress(_ context.Context, _ map[string]any) error {
	return f.err
}

func (f *fakeModelService) ObserveTrainingLog(_ context.Context, _ string, _ entity.TrainingLogEntry) error {
	return f.err
}

func (f *fakeModelService) ListModels(_ context.Context, _ string) ([]entity.Model, error) {
	if f.models != nil {
		return f.models, f.err
	}
	return []entity.Model{}, f.err
}

func (f *fakeModelService) GetModelEvaluation(_ context.Context, _ string) (*entity.ModelEvaluation, error) {
	if f.evaluation != nil {
		return f.evaluation, f.err
	}
	return &entity.ModelEvaluation{RuntimePackageID: "test-runtime"}, f.err
}

func (f *fakeModelService) GetModelEvolution(_ context.Context, _ string) (*entity.ModelEvolutionEvidence, error) {
	if f.evolution != nil {
		return f.evolution, f.err
	}
	return &entity.ModelEvolutionEvidence{RuntimePackageID: "test-runtime", EvaluationRunID: "eval-test"}, f.err
}

func TestModelHandler_TrainingPreflight(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("Missing snapshot_id returns 400", func(t *testing.T) {
		h := NewModelHandler(&fakeModelService{})
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
		h := NewModelHandler(&fakeModelService{})
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
		h := NewModelHandler(&fakeModelService{})
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
		h := NewModelHandler(&fakeModelService{})
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
		h := NewModelHandler(&fakeModelService{
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
		h := NewModelHandler(&fakeModelService{
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
		h := NewModelHandler(&fakeModelService{preflight: expected})
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

func TestModelHandler_ListSnapshots(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("Invalid limit returns 400", func(t *testing.T) {
		h := NewModelHandler(&fakeModelService{})
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
		h := NewModelHandler(&fakeModelService{})
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
		h := NewModelHandler(&fakeModelService{err: errors.New("clickhouse down")})
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
		h := NewModelHandler(&fakeModelService{snapshots: expected})
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

func TestModelHandler_ControlTraining(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("Malformed JSON returns 400", func(t *testing.T) {
		h := NewModelHandler(&fakeModelService{})
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
		h := NewModelHandler(&fakeModelService{})
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
		h := NewModelHandler(&fakeModelService{})
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
		h := NewModelHandler(&fakeModelService{})
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
		h := NewModelHandler(&fakeModelService{})
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
		h := NewModelHandler(&fakeModelService{})
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
		h := NewModelHandler(&fakeModelService{err: fmt.Errorf("%w: invalid state", taxonomy.ErrInvalidRequest)})
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
		h := NewModelHandler(&fakeModelService{err: errors.New("dispatcher unavailable")})
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

func TestModelHandler_GetActiveTraining(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("Invalid ticket_id pattern returns 400", func(t *testing.T) {
		h := NewModelHandler(&fakeModelService{})
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
		h := NewModelHandler(&fakeModelService{})
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
		h := NewModelHandler(&fakeModelService{
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

func TestModelHandler_ListModels(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("Returns list of models with count and source", func(t *testing.T) {
		h := NewModelHandler(&fakeModelService{
			models: []entity.Model{
				{
					ModelID:          "model-1",
					RuntimePackageID: "pkg-1",
					Task:             "candidate_vetting",
					Status:           "VALIDATED",
				},
			},
		})
		router := gin.New()
		router.GET("/models", h.ListModels)

		req := httptest.NewRequest(http.MethodGet, "/models", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", rec.Code)
		}
		var body struct {
			Models []map[string]any `json:"models"`
			Count  int              `json:"count"`
			Source string           `json:"source"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if body.Count != 1 || len(body.Models) != 1 || body.Source != "minio-runtime-registry" {
			t.Fatalf("unexpected response: %+v", body)
		}
	})
}

func TestModelHandler_GetModelEvaluation(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("Returns 200 with evaluation payload", func(t *testing.T) {
		h := NewModelHandler(&fakeModelService{
			evaluation: &entity.ModelEvaluation{
				RuntimePackageID: "pkg-1",
				EvaluationRunID:  "eval-1",
			},
		})
		router := gin.New()
		router.GET("/models/:runtime_package_id/evaluation", h.GetModelEvaluation)

		req := httptest.NewRequest(http.MethodGet, "/models/pkg-1/evaluation", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", rec.Code)
		}
		var body entity.ModelEvaluation
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if body.RuntimePackageID != "pkg-1" || body.EvaluationRunID != "eval-1" {
			t.Fatalf("unexpected body: %+v", body)
		}
	})

	t.Run("Returns 404 when object not found", func(t *testing.T) {
		h := NewModelHandler(&fakeModelService{
			err: provider.ErrObjectNotFound,
		})
		router := gin.New()
		router.GET("/models/:runtime_package_id/evaluation", h.GetModelEvaluation)

		req := httptest.NewRequest(http.MethodGet, "/models/pkg-missing/evaluation", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusNotFound {
			t.Fatalf("expected 404, got %d", rec.Code)
		}
	})
}

func TestModelHandler_GetModelEvolution(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("Returns 200 with evolution evidence", func(t *testing.T) {
		h := NewModelHandler(&fakeModelService{
			evolution: &entity.ModelEvolutionEvidence{
				RuntimePackageID: "pkg-1",
				EvaluationRunID:  "eval-1",
				GoldSnapshotID:   "gold-1",
			},
		})
		router := gin.New()
		router.GET("/models/:runtime_package_id/evolution", h.GetModelEvolution)

		req := httptest.NewRequest(http.MethodGet, "/models/pkg-1/evolution", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", rec.Code)
		}
		var body entity.ModelEvolutionEvidence
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if body.RuntimePackageID != "pkg-1" || body.GoldSnapshotID != "gold-1" {
			t.Fatalf("unexpected body: %+v", body)
		}
	})

	t.Run("Returns 404 when evolution not found", func(t *testing.T) {
		h := NewModelHandler(&fakeModelService{
			err: provider.ErrObjectNotFound,
		})
		router := gin.New()
		router.GET("/models/:runtime_package_id/evolution", h.GetModelEvolution)

		req := httptest.NewRequest(http.MethodGet, "/models/pkg-missing/evolution", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusNotFound {
			t.Fatalf("expected 404, got %d", rec.Code)
		}
	})
}


