package pubsub

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"go-api/internal/domain/entity"
	"go-api/internal/provider"

	"github.com/nats-io/nats.go"
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

func BenchmarkParseSubjectToWorkflow(b *testing.B) {
	subject := "aurora.v1.inference.candidate.requested"
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _, _ = parseSubjectToWorkflow(subject)
	}
}

func TestNATSPubSubDispatchMessagePublishesToBroker(t *testing.T) {
	broker := provider.NewSSEBroker()
	sub, err := broker.Subscribe(context.Background(), "inference")
	if err != nil {
		t.Fatalf("subscribe inference: %v", err)
	}
	defer sub.Close()

	ps := New(Config{
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

	ps.dispatchMessage(context.Background(), msg)

	select {
	case event := <-sub.Events:
		if event.Topic != "inference:test-job-123" {
			t.Errorf("expected topic inference:test-job-123, got %s", event.Topic)
		}
		var data map[string]any
		if err := json.Unmarshal(event.Data, &data); err != nil {
			t.Fatalf("failed to unmarshal event data: %v", err)
		}
		if data["workflow"] != "inference" {
			t.Errorf("expected workflow inference, got %v", data["workflow"])
		}
		if data["job_id"] != "test-job-123" {
			t.Errorf("expected job_id test-job-123, got %v", data["job_id"])
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for event from broker")
	}
}

func TestNATSPubSubExtractsTrainingJobIDFromRequestedEvent(t *testing.T) {
	broker := provider.NewSSEBroker()
	sub, err := broker.Subscribe(context.Background(), "ml")
	if err != nil {
		t.Fatalf("subscribe ml: %v", err)
	}
	defer sub.Close()

	ps := New(Config{
		NATSURL: "nats://localhost:4222",
		Broker:  broker,
	})
	payload, _ := json.Marshal(map[string]any{
		"training_job_id": "train-immutable-1",
		"task":            "candidate_vetting",
	})
	ps.dispatchMessage(context.Background(), &nats.Msg{
		Subject: "aurora.v1.ml.training.requested",
		Data:    payload,
	})

	select {
	case event := <-sub.Events:
		if event.Topic != "ml:train-immutable-1" {
			t.Fatalf("expected ML topic ml:train-immutable-1, got %q", event.Topic)
		}
		var data map[string]any
		if err := json.Unmarshal(event.Data, &data); err != nil {
			t.Fatalf("failed to unmarshal event data: %v", err)
		}
		if data["job_id"] != "train-immutable-1" {
			t.Fatalf("expected training job id, got %v", data["job_id"])
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for ML event")
	}
}

type fakeDAGAggregationObserver struct {
	observed []entity.PreprocessingRuntimeEvent
}

func (f *fakeDAGAggregationObserver) QueryGraph(context.Context, string, string) (*entity.DAGGraph, error) {
	return nil, nil
}
func (f *fakeDAGAggregationObserver) AggregateHopMetrics(context.Context, string, string) (*entity.DAGHop, error) {
	return nil, nil
}
func (f *fakeDAGAggregationObserver) ObserveRuntime(e entity.PreprocessingRuntimeEvent) {
	f.observed = append(f.observed, e)
}

func TestHandlePreprocessingEventValidatesWorkerID(t *testing.T) {
	observer := &fakeDAGAggregationObserver{}
	ps := New(Config{
		NATSURL:        "nats://localhost:4222",
		Broker:         provider.NewSSEBroker(),
		DAGAggregation: observer,
	})

	// 1. Empty worker_id should be rejected at transport
	payloadEmptyWorker, _ := json.Marshal(map[string]any{
		"event":     "worker_spawned",
		"worker_id": "   ",
	})
	ps.handlePreprocessingEvent(context.Background(), &nats.Msg{
		Subject: "aurora.v1.preprocessing.runtime",
		Data:    payloadEmptyWorker,
	})
	if len(observer.observed) != 0 {
		t.Fatalf("expected empty worker_id to be dropped, got: %d events", len(observer.observed))
	}

	// 2. Valid worker_id should be trimmed and accepted with defaulted OccurredAt
	payloadValid, _ := json.Marshal(map[string]any{
		"event":     "worker_spawned",
		"worker_id": "  preprocess-01  ",
		"ticket_id": "  RUN-01  ",
	})
	ps.handlePreprocessingEvent(context.Background(), &nats.Msg{
		Subject: "aurora.v1.preprocessing.runtime",
		Data:    payloadValid,
	})
	if len(observer.observed) != 1 {
		t.Fatalf("expected 1 event, got: %d", len(observer.observed))
	}
	obs := observer.observed[0]
	if obs.WorkerID != "preprocess-01" {
		t.Errorf("expected trimmed worker ID 'preprocess-01', got: %q", obs.WorkerID)
	}
	if obs.TicketID != "RUN-01" {
		t.Errorf("expected trimmed ticket ID 'RUN-01', got: %q", obs.TicketID)
	}
	if obs.OccurredAt.IsZero() {
		t.Errorf("expected OccurredAt to be defaulted to current time, got zero")
	}
}
