package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"go-api/internal/provider"

	"github.com/gin-gonic/gin"
)

type ingestObservationPublisher interface {
	PublishCore(context.Context, string, []byte) error
}

type EventsHandler struct {
	broker       *provider.SSEBroker
	observations ingestObservationPublisher
}

type observationTarget struct {
	registerSubject   string
	unregisterSubject string
	payload           []byte
}

func observationSubject(workflow, action string) string {
	switch workflow {
	case "ingest":
		return "aurora.v1.ingest.observe." + action
	case "gold":
		return "aurora.observe.gold." + action
	default:
		return ""
	}
}

func NewEventsHandler(broker *provider.SSEBroker, observations ...ingestObservationPublisher) *EventsHandler {
	var publisher ingestObservationPublisher
	if len(observations) > 0 {
		publisher = observations[0]
	}
	return &EventsHandler{broker: broker, observations: publisher}
}

func (h *EventsHandler) Stream(c *gin.Context) {
	if h == nil || h.broker == nil {
		c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"error": "event stream unavailable"})
		return
	}

	// Parse topic query params. Sai thì trả lỗi và ngắt kết nối, không fallback.
	var topics []string
	rawTopics := c.QueryArray("topic")
	if len(rawTopics) == 0 {
		if single := strings.TrimSpace(c.Query("topic")); single != "" {
			for _, part := range strings.Split(single, ",") {
				if trimmed := strings.TrimSpace(part); trimmed != "" {
					topics = append(topics, trimmed)
				}
			}
		}
	} else {
		for _, raw := range rawTopics {
			for _, part := range strings.Split(raw, ",") {
				if trimmed := strings.TrimSpace(part); trimmed != "" {
					topics = append(topics, trimmed)
				}
			}
		}
	}

	if len(topics) == 0 {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "topic query parameter is required"})
		return
	}

	subscription, err := h.broker.Subscribe(c.Request.Context(), topics...)
	if err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	defer subscription.Close()

	// Register ephemeral NATS presence for relevant namespaces (e.g. ingest, gold)
	var targets []observationTarget
	if h.observations != nil {
		seen := make(map[string]struct{})
		for _, t := range topics {
			idx := strings.IndexByte(t, ':')
			if idx == -1 {
				continue
			}
			ns := t[:idx]
			id := t[idx+1:]
			if ns == "" || id == "" {
				continue
			}
			if _, ok := seen[t]; ok {
				continue
			}
			seen[t] = struct{}{}

			regSub := observationSubject(ns, "register")
			unregSub := observationSubject(ns, "unregister")
			if regSub != "" {
				payload, _ := json.Marshal(gin.H{"ticket_id": id, "id": id})
				targets = append(targets, observationTarget{
					registerSubject:   regSub,
					unregisterSubject: unregSub,
					payload:           payload,
				})
			}
		}
	}

	for _, target := range targets {
		_ = h.observations.PublishCore(c.Request.Context(), target.registerSubject, target.payload)
	}
	defer func() {
		for _, target := range targets {
			_ = h.observations.PublishCore(context.Background(), target.unregisterSubject, target.payload)
		}
	}()

	// Prepare SSE response headers
	c.Header("Content-Type", "text/event-stream; charset=utf-8")
	c.Header("Cache-Control", "no-cache, no-store, must-revalidate")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")
	c.Status(http.StatusOK)
	c.Writer.Flush()

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
			if event.Type == "" || len(event.Data) == 0 {
				return
			}
			if event.ID != "" {
				fmt.Fprintf(c.Writer, "id: %s\nevent: %s\ndata: %s\n\n", event.ID, event.Type, event.Data)
			} else {
				fmt.Fprintf(c.Writer, "event: %s\ndata: %s\n\n", event.Type, event.Data)
			}
			c.Writer.Flush()
		case <-heartbeat.C:
			for _, target := range targets {
				_ = h.observations.PublishCore(c.Request.Context(), target.registerSubject, target.payload)
			}
			fmt.Fprint(c.Writer, ": keep-alive\n\n")
			c.Writer.Flush()
		}
	}
}
