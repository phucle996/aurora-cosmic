package pubsub

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/nats-io/nats.go"
	"go-api/internal/provider"
)

type eventMeta struct {
	JobID             string `json:"job_id"`
	TrainingJobID     string `json:"training_job_id"`
	Task              string `json:"task"`
	TicketID          string `json:"ticket_id"`
	PromotionTicketID string `json:"promotion_ticket_id"`
}

// dispatchMessage routes a message based on its subject key and calls the relevant service.
// It achieves zero allocations on subject parsing by directly slicing without strings.Split.
func (p *NATSPubSub) dispatchMessage(ctx context.Context, msg *nats.Msg) {
	subject := msg.Subject

	workflow, eventType, status := parseSubjectToWorkflow(subject)
	jobID := ""
	ticketID := ""

	if len(msg.Data) > 0 {
		var meta eventMeta
		if json.Unmarshal(msg.Data, &meta) == nil {
			if meta.JobID != "" {
				jobID = meta.JobID
			} else if meta.TrainingJobID != "" {
				jobID = meta.TrainingJobID
			}
			if meta.TicketID != "" {
				ticketID = meta.TicketID
			} else if meta.PromotionTicketID != "" {
				ticketID = meta.PromotionTicketID
			}
		}
	}

	// Apply runtime hooks before notifying SSE subscribers so a dashboard
	// refresh always observes the event that triggered it.
	switch {
	case strings.HasPrefix(subject, "aurora.v1.bronze."):
		p.handleBronzeEvent(ctx, msg)
	case strings.HasPrefix(subject, "aurora.v1.silver."):
		p.handleSilverEvent(ctx, msg)
	case strings.HasPrefix(subject, "aurora.v1.gold."):
		p.handleGoldEvent(ctx, msg)
	case strings.HasPrefix(subject, "aurora.v1.inference."):
		p.handleInferenceEvent(ctx, msg, jobID)
	case strings.HasPrefix(subject, "aurora.v1.ml."), strings.HasPrefix(subject, "aurora.live.ml."):
		p.handleMLEvent(ctx, msg, jobID)
	case strings.HasPrefix(subject, "aurora.v1.preprocessing."):
		p.handlePreprocessingEvent(ctx, msg)
	case strings.HasPrefix(subject, "aurora.live.gold."):
		p.handleGoldEvent(ctx, msg)
	}

	// Construct generic topic and payload envelope for SSE subscribers
	topic := workflow
	if ticketID != "" {
		topic = workflow + ":" + ticketID
	} else if jobID != "" {
		topic = workflow + ":" + jobID
	}

	payloadMap := map[string]any{
		"type":        eventType,
		"topic":       topic,
		"workflow":    workflow,
		"status":      status,
		"occurred_at": time.Now().UTC(),
	}
	if jobID != "" {
		payloadMap["job_id"] = jobID
	}
	if ticketID != "" {
		payloadMap["ticket_id"] = ticketID
	}
	if len(msg.Data) > 0 {
		payloadMap["payload"] = json.RawMessage(msg.Data)
	}
	data, _ := json.Marshal(payloadMap)

	// Broadcast to stage topic on SSE broker
	_ = p.broker.Publish(ctx, topic, provider.Event{
		Type:  "workflow",
		Topic: topic,
		Data:  data,
	})

	// Also broadcast to unified obj: and ticket: topics if ticketID or jobID is available
	if ticketID != "" {
		objTopic := "obj:" + ticketID
		if objTopic != topic {
			_ = p.broker.Publish(ctx, objTopic, provider.Event{
				Type:  "workflow",
				Topic: objTopic,
				Data:  data,
			})
		}
		ticketTopic := "ticket:" + ticketID
		if ticketTopic != topic {
			_ = p.broker.Publish(ctx, ticketTopic, provider.Event{
				Type:  "workflow",
				Topic: ticketTopic,
				Data:  data,
			})
		}
	} else if jobID != "" {
		objTopic := "obj:" + jobID
		if objTopic != topic {
			_ = p.broker.Publish(ctx, objTopic, provider.Event{
				Type:  "workflow",
				Topic: objTopic,
				Data:  data,
			})
		}
	}
}

// parseSubjectToWorkflow converts a NATS subject into a workflow, eventType, and status
// without allocating slices on the heap (zero allocations).
func parseSubjectToWorkflow(subject string) (workflow, eventType, status string) {
	eventType = subject
	dot1 := strings.IndexByte(subject, '.')
	if dot1 == -1 {
		return "general", eventType, "received"
	}
	dot2 := strings.IndexByte(subject[dot1+1:], '.')
	if dot2 == -1 {
		return "general", eventType, "received"
	}
	dot2 = dot1 + 1 + dot2

	dot3 := strings.IndexByte(subject[dot2+1:], '.')
	if dot3 == -1 {
		workflow = subject[dot2+1:]
		status = "received"
		return workflow, eventType, status
	}
	dot3 = dot2 + 1 + dot3
	workflow = subject[dot2+1 : dot3]

	lastDot := strings.LastIndexByte(subject, '.')
	if lastDot > dot2 {
		status = subject[lastDot+1:]
	} else {
		status = "received"
	}
	return workflow, eventType, status
}
