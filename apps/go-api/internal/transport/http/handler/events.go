package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"go-api/internal/events"

	"github.com/gin-gonic/gin"
)

type ingestObservationPublisher interface {
	PublishCore(context.Context, string, []byte) error
}

type EventsHandler struct {
	broker       *events.Broker
	observations ingestObservationPublisher
}

func observationSubject(workflow, action string) string {
	switch workflow {
	case "ingest":
		// Preserve the ingester's established observation contract.
		return "aurora.v1.ingest.observe." + action
	case "gold":
		// Gold observation messages stay outside aurora.v1.gold.> so the
		// AURORA_GOLD JetStream never retains browser presence events.
		return "aurora.observe.gold." + action
	default:
		return ""
	}
}

func NewEventsHandler(broker *events.Broker, observations ...ingestObservationPublisher) *EventsHandler {
	var publisher ingestObservationPublisher
	if len(observations) > 0 {
		publisher = observations[0]
	}
	return &EventsHandler{broker: broker, observations: publisher}
}

func (h *EventsHandler) Stream(c *gin.Context) {
	if h == nil || h.broker == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "event stream unavailable"})
		return
	}
	workflow := strings.TrimSpace(c.Query("workflow"))
	ticketID := strings.TrimSpace(c.Query("ticket"))
	registerSubject := observationSubject(workflow, "register")
	unregisterSubject := observationSubject(workflow, "unregister")
	if registerSubject != "" && ticketID != "" && h.observations != nil {
		payload, _ := json.Marshal(gin.H{"ticket_id": ticketID})
		_ = h.observations.PublishCore(c.Request.Context(), registerSubject, payload)
		defer func() {
			_ = h.observations.PublishCore(context.Background(), unregisterSubject, payload)
		}()
	}
	c.Header("Content-Type", "text/event-stream; charset=utf-8")
	c.Header("Cache-Control", "no-cache, no-store, must-revalidate")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")
	c.Status(http.StatusOK)
	c.Writer.Flush()

	subscription := h.broker.Subscribe(c.Request.Context(), workflow, ticketID)
	defer subscription.Close()
	fmt.Fprint(c.Writer, "event: ready\ndata: {\"status\":\"connected\"}\n\n")
	c.Writer.Flush()
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case <-c.Request.Context().Done():
			return
		case event, ok := <-subscription.Events:
			if !ok {
				return
			}
			eventMap := gin.H{
				"id":          event.ID,
				"type":        event.Type,
				"workflow":    event.Workflow,
				"status":      event.Status,
				"occurred_at": event.OccurredAt,
			}
			if event.JobID != "" {
				eventMap["job_id"] = event.JobID
			}
			if event.TicketID != "" {
				eventMap["ticket_id"] = event.TicketID
			}
			if len(event.Payload) > 0 {
				eventMap["payload"] = json.RawMessage(event.Payload)
			}
			payload, err := json.Marshal(eventMap)
			if err != nil {
				continue
			}
			fmt.Fprintf(c.Writer, "id: %s\nevent: workflow\ndata: %s\n\n", event.ID, payload)
			c.Writer.Flush()
		case <-heartbeat.C:
			if registerSubject != "" && ticketID != "" && h.observations != nil {
				payload, _ := json.Marshal(gin.H{"ticket_id": ticketID})
				_ = h.observations.PublishCore(c.Request.Context(), registerSubject, payload)
			}
			fmt.Fprint(c.Writer, ": keep-alive\n\n")
			c.Writer.Flush()
		}
	}
}
