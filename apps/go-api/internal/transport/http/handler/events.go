package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"go-api/internal/events"

	"github.com/gin-gonic/gin"
)

type EventsHandler struct{ broker *events.Broker }

func NewEventsHandler(broker *events.Broker) *EventsHandler {
	return &EventsHandler{broker: broker}
}

func (h *EventsHandler) Stream(c *gin.Context) {
	if h == nil || h.broker == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "event stream unavailable"})
		return
	}
	workflow := strings.TrimSpace(c.Query("workflow"))
	c.Header("Content-Type", "text/event-stream; charset=utf-8")
	c.Header("Cache-Control", "no-cache, no-store, must-revalidate")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")
	c.Status(http.StatusOK)
	c.Writer.Flush()

	subscription := h.broker.Subscribe(c.Request.Context(), workflow)
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
			fmt.Fprint(c.Writer, ": keep-alive\n\n")
			c.Writer.Flush()
		}
	}
}
