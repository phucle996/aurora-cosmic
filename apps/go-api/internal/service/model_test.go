package service

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"

	natsio "github.com/nats-io/nats.go"
	"go-api/infra/nats"
	"go-api/internal/domain/entity"
	"go-api/internal/provider"
	"go-api/internal/taxonomy"
)

type memoryModelObjects struct {
	objects map[string][]byte
}

func (m *memoryModelObjects) Ping(context.Context) error { return nil }
func (m *memoryModelObjects) ListObjects(_ context.Context, prefix string) ([]provider.ObjectInfo, error) {
	items := make([]provider.ObjectInfo, 0)
	for key := range m.objects {
		if strings.HasPrefix(key, prefix) {
			items = append(items, provider.ObjectInfo{Key: key})
		}
	}
	return items, nil
}
func (m *memoryModelObjects) ListObjectsWithMetadata(ctx context.Context, prefix string) ([]provider.ObjectInfo, error) {
	return nil, nil
}
func (m *memoryModelObjects) ListObjectsCursor(context.Context, string, string, int) ([]provider.ObjectInfo, string, bool, error) {
	return nil, "", false, nil
}
func (m *memoryModelObjects) GetObject(_ context.Context, key string) ([]byte, error) {
	data, ok := m.objects[key]
	if !ok {
		return nil, provider.ErrObjectNotFound
	}
	return data, nil
}
func (m *memoryModelObjects) PutObject(_ context.Context, key string, data []byte, _ string) error {
	m.objects[key] = data
	return nil
}
func (m *memoryModelObjects) DeleteObject(_ context.Context, key string) error {
	delete(m.objects, key)
	return nil
}

type fakeModelRepo struct {
	preflightReport *entity.TrainingPreflight
	snapshots       []entity.ModelTrainingSnapshot
	err             error
}

func (f *fakeModelRepo) TrainingPreflight(_ context.Context, _ []string) (*entity.TrainingPreflight, error) {
	return f.preflightReport, f.err
}

func (f *fakeModelRepo) ListTrainingSnapshots(_ context.Context, _ int) ([]entity.ModelTrainingSnapshot, error) {
	return f.snapshots, f.err
}

func TestModelService_TrainingPreflight(t *testing.T) {
	validSnapshotID := "gold-v1-test-snapshot"
	manifestData := []byte(`{"snapshot_id":"gold-v1-test-snapshot"}`)

	objects := &memoryModelObjects{
		objects: map[string][]byte{
			"gold/snapshots/" + validSnapshotID + "/manifest.json": manifestData,
		},
	}

	repo := &fakeModelRepo{
		preflightReport: &entity.TrainingPreflight{
			SnapshotIDs:     []string{validSnapshotID},
			Tier:            "EXPERIMENTAL",
			PositiveTargets: 65,
			NegativeTargets: 70,
		},
	}

	svc := NewModelService(objects, nil, repo)
	ctx := context.Background()

	t.Run("Rejects non-existent snapshot in MinIO", func(t *testing.T) {
		_, err := svc.TrainingPreflight(ctx, []string{"gold-v1-non-existent"})
		if err == nil || !errors.Is(err, taxonomy.ErrInvalidRequest) {
			t.Fatalf("expected ErrInvalidRequest for missing snapshot, got %v", err)
		}
	})

	t.Run("Passes and returns report for existing snapshot", func(t *testing.T) {
		report, err := svc.TrainingPreflight(ctx, []string{validSnapshotID})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if report.Tier == "BLOCKED" {
			t.Fatalf("expected report not to be BLOCKED")
		}
		if report.Tier != "EXPERIMENTAL" {
			t.Fatalf("expected tier EXPERIMENTAL, got %s", report.Tier)
		}
	})
}

func TestModelService_ListTrainingSnapshots(t *testing.T) {
	ctx := context.Background()
	expected := []entity.ModelTrainingSnapshot{
		{
			SnapshotID:     "gold-v1-test",
			Key:            "gold/snapshots/gold-v1-test/manifest.json",
			LastModified:   "2026-09-20T10:00:00Z",
			SizeBytes:      1024,
			CandidateCount: 15,
		},
	}

	repo := &fakeModelRepo{snapshots: expected}
	svc := NewModelService(&memoryModelObjects{}, nil, repo)

	results, err := svc.ListTrainingSnapshots(ctx, 50)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(results) != 1 || results[0].SnapshotID != "gold-v1-test" {
		t.Fatalf("expected 1 result with gold-v1-test, got %+v", results)
	}
}

func TestModelService_StartTraining_BlockedByPreflight(t *testing.T) {
	validSnapshotID := "gold-v1-test-snapshot"
	manifestData := []byte(`{"snapshot_id":"gold-v1-test-snapshot"}`)

	objects := &memoryModelObjects{
		objects: map[string][]byte{
			"gold/snapshots/" + validSnapshotID + "/manifest.json": manifestData,
		},
	}

	repo := &fakeModelRepo{
		preflightReport: &entity.TrainingPreflight{
			SnapshotIDs:     []string{validSnapshotID},
			Tier:            "BLOCKED",
			PositiveTargets: 2,
			NegativeTargets: 1,
		},
	}

	natsClient := &nats.Client{URL: "nats://localhost:4222"}
	natsClient.PublishMsgFunc = func(_ context.Context, _ *natsio.Msg) (*natsio.PubAck, error) {
		t.Fatal("NATS publish should not be called when preflight is BLOCKED")
		return nil, nil
	}

	svc := NewModelService(objects, natsClient, repo)
	ctx := context.Background()

	spec := entity.StartTrainingSpec{
		TicketID:      "RUN-20260920-0001",
		Task:          "candidate_vetting",
		SnapshotIDs:   []string{validSnapshotID},
		TrainingMode:  "scratch",
		ComputeTarget: "cpu",
		Epochs:        50,
		BatchSize:     32,
		LearningRate:  0.001,
		Seed:          42,
	}

	_, err := svc.StartTraining(ctx, spec)
	if err == nil {
		t.Fatal("expected error when preflight is BLOCKED")
	}
	if !errors.Is(err, taxonomy.ErrInvalidRequest) {
		t.Fatalf("expected ErrInvalidRequest, got: %v", err)
	}
}

func TestModelService_ControlTraining(t *testing.T) {
	ctx := context.Background()

	t.Run("Unavailable NATS returns error", func(t *testing.T) {
		svc := NewModelService(&memoryModelObjects{}, nil, &fakeModelRepo{})
		_, err := svc.ControlTraining(ctx, entity.TrainingControlSpec{
			TicketID: "RUN-TEST-001",
			Action:   "cancel",
		})
		if err == nil || errors.Is(err, taxonomy.ErrInvalidRequest) {
			t.Fatalf("expected dispatcher unavailable error, got %v", err)
		}
	})

	t.Run("Successful dispatch for cancel", func(t *testing.T) {
		var publishedSubject string
		var publishedPayload map[string]string

		natsClient := &nats.Client{URL: "nats://localhost:4222"}
		natsClient.PublishFunc = func(_ context.Context, subject string, payload []byte) error {
			publishedSubject = subject
			return json.Unmarshal(payload, &publishedPayload)
		}

		svc := NewModelService(&memoryModelObjects{}, natsClient, &fakeModelRepo{})
		res, err := svc.ControlTraining(ctx, entity.TrainingControlSpec{
			TicketID: "RUN-TEST-001",
			Action:   "cancel",
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if res.TicketID != "RUN-TEST-001" || res.Action != "cancel" || res.Status != "dispatched" {
			t.Fatalf("unexpected result: %+v", res)
		}
		if publishedSubject != "aurora.v1.ml.training.control" {
			t.Fatalf("expected subject 'aurora.v1.ml.training.control', got %s", publishedSubject)
		}
		if publishedPayload["ticket_id"] != "RUN-TEST-001" || publishedPayload["action"] != "cancel" {
			t.Fatalf("unexpected published payload: %+v", publishedPayload)
		}
	})

	t.Run("Successful dispatch for checkpoint", func(t *testing.T) {
		var publishedPayload map[string]string
		natsClient := &nats.Client{URL: "nats://localhost:4222"}
		natsClient.PublishFunc = func(_ context.Context, _ string, payload []byte) error {
			return json.Unmarshal(payload, &publishedPayload)
		}

		svc := NewModelService(&memoryModelObjects{}, natsClient, &fakeModelRepo{})
		res, err := svc.ControlTraining(ctx, entity.TrainingControlSpec{
			TicketID: "RUN-TEST-002",
			Action:   "checkpoint",
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if res.Action != "checkpoint" || publishedPayload["action"] != "checkpoint" {
			t.Fatalf("expected checkpoint action, got %+v", res)
		}
	})
}

func TestModelService_ActiveTrainingSoftState(t *testing.T) {
	ctx := context.Background()
	svc := NewModelService(&memoryModelObjects{}, nil, &fakeModelRepo{})

	// 1. Initially empty
	state, err := svc.GetActiveTraining(ctx, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if state != nil {
		t.Fatalf("expected nil state, got %+v", state)
	}

	// 2. Observe progress for a job
	err = svc.ObserveTrainingProgress(ctx, map[string]any{
		"ticket_id":        "RUN-100",
		"task":             "candidate_vetting",
		"status":           "running",
		"phase":            "training",
		"progress_percent": 40.0,
		"current_epoch":    2,
		"total_epochs":     10,
		"best_epoch":       1,
		"best_val_loss":    0.35,
		"train_loss":       0.40,
		"val_loss":         0.35,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// 3. Observe log
	err = svc.ObserveTrainingLog(ctx, "RUN-100", entity.TrainingLogEntry{
		Message: "Epoch 2 completed",
		Level:   "info",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// 4. Query active training
	active, err := svc.GetActiveTraining(ctx, "RUN-100")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if active == nil {
		t.Fatal("expected active state, got nil")
	}
	if active.TicketID != "RUN-100" || active.CurrentEpoch != 2 || len(active.Logs) != 1 || len(active.LossHistory) != 1 {
		t.Fatalf("unexpected state: %+v", active)
	}
}

func TestModelService_ListModels(t *testing.T) {
	ctx := context.Background()
	objects := &memoryModelObjects{objects: modelFixture("PASS")}
	svc := NewModelService(objects, nil, &fakeModelRepo{})

	models, err := svc.ListModels(ctx, taxonomy.TaskCandidateVetting)
	if err != nil {
		t.Fatalf("list models error: %v", err)
	}
	if len(models) != 1 {
		t.Fatalf("expected 1 model, got %d", len(models))
	}
	if models[0].RuntimePackageID != "runtime-a" || models[0].Status != taxonomy.ModelStatusValidated {
		t.Fatalf("unexpected model: %+v", models[0])
	}
}

func TestModelService_GetModelEvaluation(t *testing.T) {
	ctx := context.Background()
	objects := &memoryModelObjects{objects: modelFixture("PASS")}
	runtimeKey := "models/runtime/candidate_vetting/model-a/runtime-a/manifest.json"
	objects.objects[runtimeKey] = []byte(strings.Replace(
		string(objects.objects[runtimeKey]),
		`"python_parity_status":"PASS"`,
		`"python_parity_status":"PASS", "source_evaluation_run_id":"eval-cand-v1-test", "model_version":"1.0.0"`,
		1,
	))

	metrics := []byte(`{"golden_pr_auc":0.91,"golden_roc_auc":0.94,"golden_precision":0.8,"golden_recall":0.75,"golden_f1":0.774,"golden_confusion_matrix":[[18,2],[3,9]],"golden_row_count":32,"golden_positive_count":12,"golden_negative_count":20,"recent_pr_auc":0.88,"recent_recall":0.70,"recent_confusion_matrix":[[17,3],[4,8]],"recent_row_count":32,"recent_positive_count":12,"recent_negative_count":20,"pr_auc_drift":-0.03,"recall_drift":-0.05}`)
	threshold := []byte(`{"decision_threshold":0.63,"validation_row_count":40,"validation_precision":0.82,"validation_recall":0.78,"validation_f1":0.80}`)
	metricsSHA := sha256.Sum256(metrics)
	thresholdSHA := sha256.Sum256(threshold)
	prefix := "models/evaluations/candidate/eval-cand-v1-test/"
	objects.objects[prefix+"metrics.json"] = metrics
	objects.objects[prefix+"threshold.json"] = threshold
	objects.objects[prefix+"manifest.json"] = []byte(fmt.Sprintf(`{"evaluation_run_id":"eval-cand-v1-test","training_run_id":"train-test","model_version":"1.0.0","golden_cohort_id":"golden-test","recent_cohort_id":"recent-test","evaluation_policy_version":"candidate-evaluation-v1","threshold_policy_version":"candidate-threshold-max-f1-v1","decision_threshold":0.63,"threshold_sha256":"%x","metrics_sha256":"%x","created_at":"2026-09-02T00:00:00Z"}`, thresholdSHA, metricsSHA))

	svc := NewModelService(objects, nil, &fakeModelRepo{})
	evaluation, err := svc.GetModelEvaluation(ctx, "runtime-a")
	if err != nil {
		t.Fatalf("get evaluation error: %v", err)
	}
	if evaluation.Golden.PRAUC == nil || *evaluation.Golden.PRAUC != 0.91 {
		t.Fatalf("unexpected golden PR-AUC: %+v", evaluation.Golden)
	}
	if evaluation.DecisionThreshold != 0.63 || evaluation.ValidationRowCount != 40 {
		t.Fatalf("unexpected decision threshold: %f", evaluation.DecisionThreshold)
	}
}

func TestModelService_GetModelEvolution(t *testing.T) {
	ctx := context.Background()
	objects := &memoryModelObjects{objects: modelFixture("PASS")}
	runtimeKey := "models/runtime/candidate_vetting/model-a/runtime-a/manifest.json"
	objects.objects[runtimeKey] = []byte(strings.Replace(
		string(objects.objects[runtimeKey]),
		`"python_parity_status":"PASS"`,
		`"python_parity_status":"PASS", "source_evaluation_run_id":"eval-cand-v1-test", "model_version":"1.0.0"`,
		1,
	))

	metrics := []byte(`{"golden_pr_auc":0.91,"golden_recall":0.75}`)
	metricsSHA := sha256.Sum256(metrics)
	prefix := "models/evaluations/candidate/eval-cand-v1-test/"
	objects.objects[prefix+"metrics.json"] = metrics
	objects.objects[prefix+"manifest.json"] = []byte(fmt.Sprintf(`{"evaluation_run_id":"eval-cand-v1-test","training_run_id":"train-test","model_version":"1.0.0","gold_snapshot_id":"gold-snap-1","gold_manifest_sha256":"gold-sha","split_id":"split-1","dataset_view_version":"dv-1","dataset_view_fingerprint":"dv-fp","training_run_manifest_sha256":"train-sha","evaluation_policy":"candidate-evaluation-v1","threshold_policy":"candidate-threshold-max-f1-v1","metrics_sha256":"%x","created_at":"2026-09-02T00:00:00Z"}`, metricsSHA))

	svc := NewModelService(objects, nil, &fakeModelRepo{})
	evolution, err := svc.GetModelEvolution(ctx, "runtime-a")
	if err != nil {
		t.Fatalf("get evolution error: %v", err)
	}
	if evolution.GoldSnapshotID != "gold-snap-1" || evolution.TrainingRunID != "train-test" {
		t.Fatalf("unexpected evolution bindings: %+v", evolution)
	}
	if evolution.GoldenPRAUC == nil || *evolution.GoldenPRAUC != 0.91 {
		t.Fatalf("unexpected golden PR-AUC: %+v", evolution)
	}
	if !evolution.GatePassed {
		t.Fatalf("expected gate passed to be true")
	}
}


