package service

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	natsio "github.com/nats-io/nats.go"
	"go-api/infra/nats"
	"go-api/internal/domain/entity"
	"go-api/internal/provider"
	"go-api/internal/taxonomy"
)

type memoryModelNewObjects struct {
	objects map[string][]byte
}

func (m *memoryModelNewObjects) Ping(context.Context) error { return nil }
func (m *memoryModelNewObjects) ListObjects(_ context.Context, _ string) ([]provider.ObjectInfo, error) {
	return nil, nil
}
func (m *memoryModelNewObjects) ListObjectsWithMetadata(ctx context.Context, prefix string) ([]provider.ObjectInfo, error) {
	return nil, nil
}
func (m *memoryModelNewObjects) ListObjectsCursor(context.Context, string, string, int) ([]provider.ObjectInfo, string, bool, error) {
	return nil, "", false, nil
}
func (m *memoryModelNewObjects) GetObject(_ context.Context, key string) ([]byte, error) {
	data, ok := m.objects[key]
	if !ok {
		return nil, provider.ErrObjectNotFound
	}
	return data, nil
}
func (m *memoryModelNewObjects) PutObject(_ context.Context, key string, data []byte, _ string) error {
	m.objects[key] = data
	return nil
}
func (m *memoryModelNewObjects) DeleteObject(_ context.Context, key string) error {
	delete(m.objects, key)
	return nil
}

type fakeModelNewRepo struct {
	preflightReport *entity.TrainingPreflight
	snapshots       []entity.ModelTrainingSnapshot
	err             error
}

func (f *fakeModelNewRepo) TrainingPreflight(_ context.Context, _ []string) (*entity.TrainingPreflight, error) {
	return f.preflightReport, f.err
}

func (f *fakeModelNewRepo) ListTrainingSnapshots(_ context.Context, _ int) ([]entity.ModelTrainingSnapshot, error) {
	return f.snapshots, f.err
}

func TestModelNewService_TrainingPreflight(t *testing.T) {
	validSnapshotID := "gold-v1-test-snapshot"
	manifestData := []byte(`{"snapshot_id":"gold-v1-test-snapshot"}`)

	objects := &memoryModelNewObjects{
		objects: map[string][]byte{
			"gold/snapshots/" + validSnapshotID + "/manifest.json": manifestData,
		},
	}

	repo := &fakeModelNewRepo{
		preflightReport: &entity.TrainingPreflight{
			SnapshotIDs:     []string{validSnapshotID},
			Tier:            "EXPERIMENTAL",
			PositiveTargets: 65,
			NegativeTargets: 70,
		},
	}

	svc := NewModelNewService(objects, nil, repo)
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

func TestModelNewService_ListTrainingSnapshots(t *testing.T) {
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

	repo := &fakeModelNewRepo{snapshots: expected}
	svc := NewModelNewService(&memoryModelNewObjects{}, nil, repo)

	results, err := svc.ListTrainingSnapshots(ctx, 50)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(results) != 1 || results[0].SnapshotID != "gold-v1-test" {
		t.Fatalf("expected 1 result with gold-v1-test, got %+v", results)
	}
}

func TestModelNewService_StartTraining_BlockedByPreflight(t *testing.T) {
	validSnapshotID := "gold-v1-test-snapshot"
	manifestData := []byte(`{"snapshot_id":"gold-v1-test-snapshot"}`)

	objects := &memoryModelNewObjects{
		objects: map[string][]byte{
			"gold/snapshots/" + validSnapshotID + "/manifest.json": manifestData,
		},
	}

	repo := &fakeModelNewRepo{
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

	svc := NewModelNewService(objects, natsClient, repo)
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

func TestModelNewService_ControlTraining(t *testing.T) {
	ctx := context.Background()

	t.Run("Unavailable NATS returns error", func(t *testing.T) {
		svc := NewModelNewService(&memoryModelNewObjects{}, nil, &fakeModelNewRepo{})
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

		svc := NewModelNewService(&memoryModelNewObjects{}, natsClient, &fakeModelNewRepo{})
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

		svc := NewModelNewService(&memoryModelNewObjects{}, natsClient, &fakeModelNewRepo{})
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

func TestModelNewService_ActiveTrainingSoftState(t *testing.T) {
	ctx := context.Background()
	svc := NewModelNewService(&memoryModelNewObjects{}, nil, &fakeModelNewRepo{})

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

