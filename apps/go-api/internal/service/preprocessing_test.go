package service

import (
	"context"
	"testing"
	"time"

	"go-api/internal/domain/entity"
	"go-api/internal/provider"
)

type fakeEventPublisher struct {
	events []provider.Event
}

func (f *fakeEventPublisher) Publish(_ context.Context, _ string, ev provider.Event) error {
	f.events = append(f.events, ev)
	return nil
}

func TestPreprocessingStartRequiresTicketID(t *testing.T) {
	svc := NewPreprocessingService(nil, &fakeEventPublisher{}, nil)
	_, err := svc.Start(context.Background(), entity.PreprocessingStartRequest{
		Mode:        "stream",
		WorkerCount: 2,
	})
	if err == nil || err.Error() != "ticket_id is required" {
		t.Fatalf("expected 'ticket_id is required', got: %v", err)
	}
}

func TestPreprocessingStartAndStop(t *testing.T) {
	pub := &fakeEventPublisher{}
	svc := NewPreprocessingService(nil, pub, nil)

	job, err := svc.Start(context.Background(), entity.PreprocessingStartRequest{
		TicketID:    "ticket-run-123",
		Mode:        "stream",
		WorkerCount: 3,
	})
	if err != nil {
		t.Fatalf("unexpected start error: %v", err)
	}
	if job.TicketID != "ticket-run-123" || job.Status != "running" || job.WorkerCount != 3 {
		t.Fatalf("unexpected job after start: %#v", job)
	}

	active, err := svc.GetActiveJob(context.Background())
	if err != nil || active == nil || active.TicketID != "ticket-run-123" {
		t.Fatalf("expected active job ticket-run-123, got %#v (err: %v)", active, err)
	}

	stopped, err := svc.Stop(context.Background(), "ticket-run-123")
	if err != nil {
		t.Fatalf("unexpected stop error: %v", err)
	}
	if stopped.Status != "cancelling" {
		t.Fatalf("expected status cancelling, got %s", stopped.Status)
	}

	// Stop with mismatched ticket ID should fail
	_, err = svc.Stop(context.Background(), "mismatched-ticket")
	if err == nil {
		t.Fatal("expected error stopping mismatched ticket")
	}
}

func TestPreprocessingActiveJobRecovery(t *testing.T) {
	now := time.Now().UTC()
	objects := fakePreprocessingObjects{
		data: map[string][]byte{
			"checkpoints/preprocessing/current.json": []byte(`{"active_run_id":"run-persisted-999"}`),
			"checkpoints/preprocessing/runs/run-persisted-999.json": []byte(`{
				"run_id": "run-persisted-999",
				"status": "RUNNING",
				"mode": "batch",
				"worker_count": 4,
				"started_at": "` + now.Format(time.RFC3339Nano) + `",
				"updated_at": "` + now.Format(time.RFC3339Nano) + `"
			}`),
		},
	}

	svc := NewPreprocessingService(nil, &fakeEventPublisher{}, objects)
	job, err := svc.GetActiveJob(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if job == nil {
		t.Fatal("expected recovered job, got nil")
	}
	if job.TicketID != "run-persisted-999" || job.Status != "running" || job.WorkerCount != 4 {
		t.Fatalf("unexpected recovered job: %#v", job)
	}
}
