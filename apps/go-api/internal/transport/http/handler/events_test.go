package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"go-api/internal/provider"

	"github.com/gin-gonic/gin"
)

func TestObservationSubjectsKeepPresenceTrafficEphemeral(t *testing.T) {
	if got := observationSubject("ingest", "register"); got != "aurora.v1.ingest.observe.register" {
		t.Fatalf("ingest observer contract changed: %q", got)
	}
	if got := observationSubject("gold", "register"); got != "aurora.observe.gold.register" {
		t.Fatalf("gold presence must remain outside the durable Gold stream: %q", got)
	}
	if got := observationSubject("unknown", "register"); got != "" {
		t.Fatalf("unsupported workflow must not create a NATS subject: %q", got)
	}
}

func TestEventsHandlerRejectsMissingTopicWithoutFallback(t *testing.T) {
	gin.SetMode(gin.TestMode)
	broker := provider.NewSSEBroker()
	h := NewEventsHandler(broker)

	// No topic query param at all
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	req, _ := http.NewRequest(http.MethodGet, "/v1/events", nil)
	c.Request = req

	h.Stream(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request on missing topic, got: %d", w.Code)
	}
	if !strings.Contains(w.Body.String(), "topic query parameter is required") {
		t.Fatalf("expected error body, got: %s", w.Body.String())
	}
}

func TestEventsHandlerStreamsGenericTopic(t *testing.T) {
	gin.SetMode(gin.TestMode)
	broker := provider.NewSSEBroker()
	h := NewEventsHandler(broker)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)

	ctx, cancel := context.WithCancel(context.Background())
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, "/v1/events?topic=obj:123", nil)
	c.Request = req

	done := make(chan struct{})
	go func() {
		h.Stream(c)
		close(done)
	}()

	// Give a few ms for subscription to register
	time.Sleep(30 * time.Millisecond)

	// Publish event to topic obj:123
	payload := json.RawMessage(`{"status":"success","id":"obj:123"}`)
	_ = broker.Publish(context.Background(), "obj:123", provider.Event{
		Type:  "object_event",
		Topic: "obj:123",
		Data:  payload,
	})

	time.Sleep(30 * time.Millisecond)
	cancel()
	<-done

	body := w.Body.String()
	if !strings.Contains(body, "event: ready") {
		t.Fatalf("expected ready event, got: %s", body)
	}
	if !strings.Contains(body, "event: object_event") {
		t.Fatalf("expected object_event, got: %s", body)
	}
	if !strings.Contains(body, `data: {"status":"success","id":"obj:123"}`) {
		t.Fatalf("expected payload in stream, got: %s", body)
	}
}
