package events

import (
	"context"
	"testing"
	"time"

	"go-api/internal/domain/entity"
)

func TestBrokerFiltersWorkflowAndClosesSubscription(t *testing.T) {
	broker := NewBroker()
	ctx, cancel := context.WithCancel(context.Background())
	subscription := broker.Subscribe(ctx, "preprocessing")
	defer cancel()

	if err := broker.Publish(context.Background(), entity.WorkflowEvent{Workflow: "ingest", Status: "running"}); err != nil {
		t.Fatalf("publish ingest: %v", err)
	}
	select {
	case event := <-subscription.Events:
		t.Fatalf("received filtered event: %#v", event)
	case <-time.After(20 * time.Millisecond):
	}

	if err := broker.Publish(context.Background(), entity.WorkflowEvent{Workflow: "preprocessing", Status: "running"}); err != nil {
		t.Fatalf("publish preprocessing: %v", err)
	}
	select {
	case event := <-subscription.Events:
		if event.ID == "" || event.Workflow != "preprocessing" {
			t.Fatalf("unexpected event: %#v", event)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for preprocessing event")
	}

	cancel()
	select {
	case _, ok := <-subscription.Events:
		if ok {
			t.Fatal("subscription channel remained open after context cancellation")
		}
	case <-time.After(time.Second):
		t.Fatal("subscription did not close after context cancellation")
	}
}
