package stream

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/nats-io/nats.go"
	"go-api/internal/domain/entity"
	"go-api/internal/domain/service"
	"go-api/internal/events"
)

// NATSStream manages message subscriptions over NATS subjects and dispatches
// incoming messages to domain services and the workflow event broker.
type NATSStream struct {
	natsURL       string
	broker        *events.Broker
	preprocessing service.Preprocessing
	ingest        service.Ingest
	inference     service.Inference
	models        service.Models
	log           *slog.Logger

	mu             sync.Mutex
	conn           *nats.Conn
	subscriptions  []*nats.Subscription
	customHandlers map[string][]MessageHandler
}

// MessageHandler is a callback invoked when a message arrives on a subscribed subject.
type MessageHandler func(ctx context.Context, msg *nats.Msg) error

// StreamConfig holds the dependencies and configuration for NATSStream.
type StreamConfig struct {
	NATSURL       string
	Broker        *events.Broker
	Preprocessing service.Preprocessing
	Ingest        service.Ingest
	Inference     service.Inference
	Models        service.Models
	Logger        *slog.Logger
}

// NewNATSStream creates a new NATSStream transport consumer.
func NewNATSStream(cfg StreamConfig) *NATSStream {
	logger := cfg.Logger
	if logger == nil {
		logger = slog.Default()
	}
	return &NATSStream{
		natsURL:        cfg.NATSURL,
		broker:         cfg.Broker,
		preprocessing:  cfg.Preprocessing,
		ingest:         cfg.Ingest,
		inference:      cfg.Inference,
		models:         cfg.Models,
		log:            logger,
		customHandlers: make(map[string][]MessageHandler),
	}
}

// RegisterHandler registers a custom callback for a specific subject or pattern.
func (s *NATSStream) RegisterHandler(subject string, handler MessageHandler) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.customHandlers[subject] = append(s.customHandlers[subject], handler)
}

// Start connects to NATS and registers default subscriptions for Aurora pipeline events.
func (s *NATSStream) Start(ctx context.Context) error {
	if s == nil {
		return errors.New("stream: nats stream is nil")
	}
	if s.natsURL == "" {
		return errors.New("stream: nats url is empty")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	nc, err := nats.Connect(s.natsURL,
		nats.Timeout(5*time.Second),
		nats.Name("aurora-api-stream-consumer"),
		nats.DisconnectErrHandler(func(_ *nats.Conn, err error) {
			if err != nil {
				s.log.Warn("NATS stream consumer disconnected", "error", err)
			}
		}),
		nats.ReconnectHandler(func(c *nats.Conn) {
			s.log.Info("NATS stream consumer reconnected", "url", c.ConnectedUrl())
		}),
	)
	if err != nil {
		return fmt.Errorf("stream: connect NATS at %s: %w", s.natsURL, err)
	}
	s.conn = nc

	defaultSubjects := []string{
		"aurora.v1.bronze.>",
		"aurora.v1.silver.>",
		"aurora.v1.gold.>",
		"aurora.v1.inference.>",
		"aurora.v1.ml.>",
		"aurora.v1.preprocessing.control",
	}

	for _, subject := range defaultSubjects {
		sub, err := nc.Subscribe(subject, s.makeMsgHandler(subject))
		if err != nil {
			s.log.Error("Failed to subscribe to subject", "subject", subject, "error", err)
			continue
		}
		s.subscriptions = append(s.subscriptions, sub)
		s.log.Info("Subscribed to NATS subject", "subject", subject)
	}

	// Register custom handlers subscriptions
	for subject, handlers := range s.customHandlers {
		sub, err := nc.Subscribe(subject, func(msg *nats.Msg) {
			reqCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
			defer cancel()
			for _, h := range handlers {
				if err := h(reqCtx, msg); err != nil {
					s.log.Error("Custom message handler failed", "subject", msg.Subject, "error", err)
				}
			}
		})
		if err != nil {
			s.log.Error("Failed to subscribe custom subject", "subject", subject, "error", err)
			continue
		}
		s.subscriptions = append(s.subscriptions, sub)
	}

	return nil
}

// makeMsgHandler creates a NATS message handler for a subject pattern.
func (s *NATSStream) makeMsgHandler(pattern string) nats.MsgHandler {
	return func(msg *nats.Msg) {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		s.log.Debug("Received NATS stream message", "subject", msg.Subject, "length", len(msg.Data))
		s.dispatchMessage(ctx, msg)
	}
}

// dispatchMessage routes a message based on its subject key and calls the relevant service.
func (s *NATSStream) dispatchMessage(ctx context.Context, msg *nats.Msg) {
	subject := msg.Subject

	// 1. Convert NATS message to a WorkflowEvent and notify broker if available
	workflow, eventType, status := parseSubjectToWorkflow(subject)
	event := entity.WorkflowEvent{
		Type:       eventType,
		Workflow:   workflow,
		Status:     status,
		OccurredAt: time.Now().UTC(),
		Payload:    msg.Data,
	}

	// Try extracting job_id if present in payload JSON
	var meta struct {
		JobID string `json:"job_id"`
		Task  string `json:"task"`
	}
	if len(msg.Data) > 0 {
		_ = json.Unmarshal(msg.Data, &meta)
		if meta.JobID != "" {
			event.JobID = meta.JobID
		}
	}

	if s.broker != nil {
		_ = s.broker.Publish(ctx, event)
	}

	// 2. Delegate to corresponding service logic
	switch {
	case strings.HasPrefix(subject, "aurora.v1.bronze."):
		s.handleBronzeEvent(ctx, msg, event)
	case strings.HasPrefix(subject, "aurora.v1.silver."):
		s.handleSilverEvent(ctx, msg, event)
	case strings.HasPrefix(subject, "aurora.v1.gold."):
		s.handleGoldEvent(ctx, msg, event)
	case strings.HasPrefix(subject, "aurora.v1.inference."):
		s.handleInferenceEvent(ctx, msg, event)
	case strings.HasPrefix(subject, "aurora.v1.ml."):
		s.handleMLEvent(ctx, msg, event)
	case strings.HasPrefix(subject, "aurora.v1.preprocessing."):
		s.handlePreprocessingEvent(ctx, msg, event)
	}
}

func (s *NATSStream) handleBronzeEvent(_ context.Context, msg *nats.Msg, _ entity.WorkflowEvent) {
	s.log.Debug("Processing Bronze event from stream", "subject", msg.Subject)
}

func (s *NATSStream) handleSilverEvent(_ context.Context, msg *nats.Msg, _ entity.WorkflowEvent) {
	s.log.Debug("Processing Silver event from stream", "subject", msg.Subject)
}

func (s *NATSStream) handleGoldEvent(_ context.Context, msg *nats.Msg, _ entity.WorkflowEvent) {
	s.log.Debug("Processing Gold event from stream", "subject", msg.Subject)
}

func (s *NATSStream) handleInferenceEvent(_ context.Context, msg *nats.Msg, event entity.WorkflowEvent) {
	s.log.Info("Inference event received", "subject", msg.Subject, "job_id", event.JobID)
}

func (s *NATSStream) handleMLEvent(_ context.Context, msg *nats.Msg, event entity.WorkflowEvent) {
	s.log.Info("ML training event received", "subject", msg.Subject, "job_id", event.JobID)
}

func (s *NATSStream) handlePreprocessingEvent(_ context.Context, msg *nats.Msg, _ entity.WorkflowEvent) {
	s.log.Debug("Preprocessing control event received", "subject", msg.Subject)
}

// parseSubjectToWorkflow converts a NATS subject into a workflow, eventType, and status.
func parseSubjectToWorkflow(subject string) (workflow, eventType, status string) {
	parts := strings.Split(subject, ".")
	if len(parts) >= 3 {
		workflow = parts[2] // e.g. "bronze", "silver", "gold", "inference", "ml", "preprocessing"
	} else {
		workflow = "general"
	}
	eventType = subject
	if len(parts) >= 4 {
		status = parts[len(parts)-1]
	} else {
		status = "received"
	}
	return workflow, eventType, status
}

// Close gracefully unsubscribes from all subjects and closes the NATS connection.
func (s *NATSStream) Close() error {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	for _, sub := range s.subscriptions {
		_ = sub.Unsubscribe()
	}
	s.subscriptions = nil

	if s.conn != nil && !s.conn.IsClosed() {
		s.conn.Close()
		s.conn = nil
	}
	return nil
}
