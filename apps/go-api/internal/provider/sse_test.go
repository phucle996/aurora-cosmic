package provider

import (
	"context"
	"encoding/json"
	"testing"
	"time"
)

func TestBrokerStrictValidationPublish(t *testing.T) {
	broker := NewSSEBroker()
	ctx := context.Background()

	// Empty topic
	if err := broker.Publish(ctx, "", Event{Type: "test", Topic: "", Data: json.RawMessage(`{}`)}); err == nil {
		t.Fatal("expected error on empty topic")
	}

	// Topic mismatch
	if err := broker.Publish(ctx, "obj:1", Event{Type: "test", Topic: "obj:2", Data: json.RawMessage(`{}`)}); err == nil {
		t.Fatal("expected error on topic mismatch")
	}

	// Empty Type
	if err := broker.Publish(ctx, "obj:1", Event{Type: "", Topic: "obj:1", Data: json.RawMessage(`{}`)}); err == nil {
		t.Fatal("expected error on empty type")
	}

	// Empty Data
	if err := broker.Publish(ctx, "obj:1", Event{Type: "test", Topic: "obj:1", Data: nil}); err == nil {
		t.Fatal("expected error on nil data")
	}
}

func TestBrokerStrictValidationSubscribe(t *testing.T) {
	broker := NewSSEBroker()
	ctx := context.Background()

	// No topics
	if _, err := broker.Subscribe(ctx); err == nil {
		t.Fatal("expected error on empty topics")
	}

	// Only empty strings
	if _, err := broker.Subscribe(ctx, "", "   "); err == nil {
		t.Fatal("expected error on whitespace-only topics")
	}
}

func TestBrokerTopicMatchingAndFiltering(t *testing.T) {
	broker := NewSSEBroker()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	subExactObj, err := broker.Subscribe(ctx, "obj:123")
	if err != nil {
		t.Fatalf("subscribe obj:123: %v", err)
	}
	subNamespaceObj, err := broker.Subscribe(ctx, "obj")
	if err != nil {
		t.Fatalf("subscribe obj: %v", err)
	}
	subIngest, err := broker.Subscribe(ctx, "ingest:ticket-1")
	if err != nil {
		t.Fatalf("subscribe ingest:ticket-1: %v", err)
	}
	subWildcard, err := broker.Subscribe(ctx, "*")
	if err != nil {
		t.Fatalf("subscribe *: %v", err)
	}

	// 1. Publish to obj:123
	payload1 := json.RawMessage(`{"status":"ready"}`)
	if err := broker.Publish(ctx, "obj:123", Event{Type: "workflow", Topic: "obj:123", Data: payload1}); err != nil {
		t.Fatalf("publish obj:123: %v", err)
	}

	// subExactObj must receive it
	select {
	case ev := <-subExactObj.Events:
		if ev.Topic != "obj:123" || string(ev.Data) != `{"status":"ready"}` {
			t.Fatalf("unexpected event on subExactObj: %#v", ev)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for event on subExactObj")
	}

	// subNamespaceObj must receive it (prefix match)
	select {
	case ev := <-subNamespaceObj.Events:
		if ev.Topic != "obj:123" {
			t.Fatalf("unexpected event on subNamespaceObj: %#v", ev)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for event on subNamespaceObj")
	}

	// subWildcard must receive it
	select {
	case ev := <-subWildcard.Events:
		if ev.Topic != "obj:123" {
			t.Fatalf("unexpected event on subWildcard: %#v", ev)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for event on subWildcard")
	}

	// subIngest must NOT receive it
	select {
	case ev := <-subIngest.Events:
		t.Fatalf("subIngest received unexpected event: %#v", ev)
	case <-time.After(30 * time.Millisecond):
	}

	// 2. Publish to obj:456
	if err := broker.Publish(ctx, "obj:456", Event{Type: "workflow", Topic: "obj:456", Data: json.RawMessage(`{"status":"created"}`)}); err != nil {
		t.Fatalf("publish obj:456: %v", err)
	}

	// subExactObj must NOT receive it
	select {
	case ev := <-subExactObj.Events:
		t.Fatalf("subExactObj received event for 456: %#v", ev)
	case <-time.After(30 * time.Millisecond):
	}

	// subNamespaceObj receives it
	select {
	case ev := <-subNamespaceObj.Events:
		if ev.Topic != "obj:456" {
			t.Fatalf("unexpected event: %#v", ev)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out on subNamespaceObj for obj:456")
	}
}

func TestBrokerClosesSubscriptionOnContextCancellation(t *testing.T) {
	broker := NewSSEBroker()
	ctx, cancel := context.WithCancel(context.Background())
	subscription, err := broker.Subscribe(ctx, "preprocessing")
	if err != nil {
		t.Fatalf("subscribe: %v", err)
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

func TestBrokerClosesExplicitly(t *testing.T) {
	broker := NewSSEBroker()
	subscription, err := broker.Subscribe(context.Background(), "test-topic")
	if err != nil {
		t.Fatalf("subscribe: %v", err)
	}

	subscription.Close()
	// Calling Close multiple times should be safe (idempotent)
	subscription.Close()

	select {
	case _, ok := <-subscription.Events:
		if ok {
			t.Fatal("expected channel to be closed")
		}
	default:
	}
}
