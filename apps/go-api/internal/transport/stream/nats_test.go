package stream

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/nats-io/nats.go"
	"go-api/internal/events"
)

func TestParseSubjectToWorkflow(t *testing.T) {
	tests := []struct {
		subject      string
		wantWorkflow string
		wantStatus   string
	}{
		{
			subject:      "aurora.v1.bronze.target-pixel.ready",
			wantWorkflow: "bronze",
			wantStatus:   "ready",
		},
		{
			subject:      "aurora.v1.silver.lightcurve.ready",
			wantWorkflow: "silver",
			wantStatus:   "ready",
		},
		{
			subject:      "aurora.v1.inference.candidate.requested",
			wantWorkflow: "inference",
			wantStatus:   "requested",
		},
		{
			subject:      "aurora.v1.preprocessing.control",
			wantWorkflow: "preprocessing",
			wantStatus:   "control",
		},
		{
			subject:      "aurora.v1.ml.training.completed",
			wantWorkflow: "ml",
			wantStatus:   "completed",
		},
		{
			subject:      "short",
			wantWorkflow: "general",
			wantStatus:   "received",
		},
	}

	for _, tt := range tests {
		t.Run(tt.subject, func(t *testing.T) {
			workflow, _, status := parseSubjectToWorkflow(tt.subject)
			if workflow != tt.wantWorkflow {
				t.Errorf("parseSubjectToWorkflow(%q) workflow = %v, want %v", tt.subject, workflow, tt.wantWorkflow)
			}
			if status != tt.wantStatus {
				t.Errorf("parseSubjectToWorkflow(%q) status = %v, want %v", tt.subject, status, tt.wantStatus)
			}
		})
	}
}

func TestNATSStreamDispatchMessagePublishesToBroker(t *testing.T) {
	broker := events.NewBroker()
	sub := broker.Subscribe(context.Background(), "inference")
	defer sub.Close()

	ns := NewNATSStream(StreamConfig{
		NATSURL: "nats://localhost:4222",
		Broker:  broker,
	})

	payload, _ := json.Marshal(map[string]any{
		"job_id": "test-job-123",
		"task":   "candidate_vetting",
	})

	msg := &nats.Msg{
		Subject: "aurora.v1.inference.candidate.requested",
		Data:    payload,
	}

	ns.dispatchMessage(context.Background(), msg)

	select {
	case event := <-sub.Events:
		if event.Workflow != "inference" {
			t.Errorf("expected workflow inference, got %s", event.Workflow)
		}
		if event.JobID != "test-job-123" {
			t.Errorf("expected job_id test-job-123, got %s", event.JobID)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for event from broker")
	}
}

func TestNATSStreamRegisterHandler(t *testing.T) {
	ns := NewNATSStream(StreamConfig{
		NATSURL: "nats://localhost:4222",
	})

	called := false
	ns.RegisterHandler("aurora.custom.test", func(ctx context.Context, msg *nats.Msg) error {
		called = true
		return nil
	})

	if len(ns.customHandlers["aurora.custom.test"]) != 1 {
		t.Fatalf("expected 1 custom handler, got %d", len(ns.customHandlers["aurora.custom.test"]))
	}
	_ = called
}

func TestNATSStreamNilSafety(t *testing.T) {
	var ns *NATSStream
	if err := ns.Start(context.Background()); err == nil {
		t.Error("expected error calling Start on nil NATSStream")
	}
	if err := ns.Close(); err != nil {
		t.Errorf("unexpected error on nil Close: %v", err)
	}
}
