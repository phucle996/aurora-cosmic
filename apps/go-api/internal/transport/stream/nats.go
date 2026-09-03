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
	natsURL           string
	broker            *events.Broker
	preprocessing     service.Preprocessing
	ingest            service.Ingest
	inference         service.Inference
	models            service.Models
	championInference service.ChampionInferencePlanner
	predictions       service.PredictionProjector
	log               *slog.Logger

	mu              sync.Mutex
	conn            *nats.Conn
	subscriptions   []*nats.Subscription
	customHandlers  map[string][]MessageHandler
	projectorSub    *nats.Subscription
	projectorCancel context.CancelFunc
	projectorDone   chan struct{}
}

// MessageHandler is a callback invoked when a message arrives on a subscribed subject.
type MessageHandler func(ctx context.Context, msg *nats.Msg) error

// StreamConfig holds the dependencies and configuration for NATSStream.
type StreamConfig struct {
	NATSURL             string
	Broker              *events.Broker
	Preprocessing       service.Preprocessing
	Ingest              service.Ingest
	Inference           service.Inference
	Models              service.Models
	ChampionInference   service.ChampionInferencePlanner
	PredictionProjector service.PredictionProjector
	Logger              *slog.Logger
}

// NewNATSStream creates a new NATSStream transport consumer.
func NewNATSStream(cfg StreamConfig) *NATSStream {
	logger := cfg.Logger
	if logger == nil {
		logger = slog.Default()
	}
	return &NATSStream{
		natsURL:           cfg.NATSURL,
		broker:            cfg.Broker,
		preprocessing:     cfg.Preprocessing,
		ingest:            cfg.Ingest,
		inference:         cfg.Inference,
		models:            cfg.Models,
		championInference: cfg.ChampionInference,
		predictions:       cfg.PredictionProjector,
		log:               logger,
		customHandlers:    make(map[string][]MessageHandler),
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
		"aurora.v1.preprocessing.runtime",
		"aurora.v1.ingest.runtime.>",
		"aurora.live.gold.>",
		"aurora.live.ml.>",
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
	flushCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := nc.FlushWithContext(flushCtx); err != nil {
		for _, sub := range s.subscriptions {
			_ = sub.Unsubscribe()
		}
		s.subscriptions = nil
		nc.Close()
		s.conn = nil
		return fmt.Errorf("stream: flush subscriptions: %w", err)
	}
	if s.predictions != nil {
		if err := s.startPredictionProjector(nc); err != nil {
			for _, sub := range s.subscriptions {
				_ = sub.Unsubscribe()
			}
			s.subscriptions = nil
			nc.Close()
			s.conn = nil
			return err
		}
	}
	if s.championInference != nil {
		go s.reconcileChampionInference()
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

const (
	inferenceStreamName       = "AURORA_INFERENCE"
	inferenceCompletionFilter = "aurora.v1.inference.*.completed"
	predictionProjectorName   = "aurora-analytics-projector-v1"
	predictionProjectedLive   = "aurora.live.ml.prediction.projected"
)

func (s *NATSStream) startPredictionProjector(nc *nats.Conn) error {
	js, err := nc.JetStream()
	if err != nil {
		return fmt.Errorf("stream: create prediction projector JetStream context: %w", err)
	}
	if _, err := js.StreamInfo(inferenceStreamName); err != nil {
		if !errors.Is(err, nats.ErrStreamNotFound) {
			return fmt.Errorf("stream: inspect inference stream: %w", err)
		}
		if _, err := js.AddStream(&nats.StreamConfig{
			Name:       inferenceStreamName,
			Subjects:   []string{"aurora.v1.inference.>"},
			Storage:    nats.FileStorage,
			Retention:  nats.LimitsPolicy,
			Duplicates: 24 * time.Hour,
		}); err != nil {
			return fmt.Errorf("stream: create inference stream: %w", err)
		}
	}
	if _, err := js.ConsumerInfo(inferenceStreamName, predictionProjectorName); err != nil {
		if !errors.Is(err, nats.ErrConsumerNotFound) {
			return fmt.Errorf("stream: inspect prediction projector consumer: %w", err)
		}
		if _, err := js.AddConsumer(inferenceStreamName, &nats.ConsumerConfig{
			Durable:       predictionProjectorName,
			AckPolicy:     nats.AckExplicitPolicy,
			AckWait:       5 * time.Minute,
			MaxDeliver:    -1,
			DeliverPolicy: nats.DeliverAllPolicy,
			FilterSubject: inferenceCompletionFilter,
		}); err != nil {
			return fmt.Errorf("stream: create prediction projector consumer: %w", err)
		}
	}
	subscription, err := js.PullSubscribe(
		inferenceCompletionFilter,
		predictionProjectorName,
		nats.Bind(inferenceStreamName, predictionProjectorName),
	)
	if err != nil {
		return fmt.Errorf("stream: bind prediction projector consumer: %w", err)
	}
	projectorCtx, cancel := context.WithCancel(context.Background())
	s.projectorSub = subscription
	s.projectorCancel = cancel
	s.projectorDone = make(chan struct{})
	go s.runPredictionProjector(projectorCtx, nc, subscription, s.projectorDone)
	return nil
}

func (s *NATSStream) runPredictionProjector(ctx context.Context, nc *nats.Conn, subscription *nats.Subscription, done chan<- struct{}) {
	defer close(done)
	if rows, err := s.predictions.Reconcile(ctx); err != nil {
		s.log.Warn("Prediction startup reconciliation completed with errors", "inserted_rows", rows, "error", err)
	} else if rows > 0 {
		s.log.Info("Prediction startup reconciliation completed", "inserted_rows", rows)
	}
	for ctx.Err() == nil {
		messages, err := subscription.Fetch(1, nats.MaxWait(time.Second))
		if err != nil {
			if ctx.Err() != nil || errors.Is(err, nats.ErrBadSubscription) {
				return
			}
			if errors.Is(err, nats.ErrTimeout) {
				continue
			}
			s.log.Warn("Prediction projector fetch failed", "error", err)
			continue
		}
		for _, message := range messages {
			projectionCtx, cancel := context.WithTimeout(ctx, time.Minute)
			result, projectErr := s.predictions.ProjectCompletion(projectionCtx, message.Data)
			cancel()
			if projectErr != nil {
				s.log.Error("Prediction projection failed; scheduling retry", "error", projectErr)
				if err := message.NakWithDelay(5 * time.Second); err != nil {
					s.log.Warn("Prediction projection NAK failed", "error", err)
				}
				continue
			}
			livePayload, err := json.Marshal(map[string]any{
				"schema_version":  1,
				"event_id":        "prediction-projected-v1-" + result.SourceEventID,
				"event_type":      predictionProjectedLive,
				"occurred_at":     time.Now().UTC().Format(time.RFC3339Nano),
				"source_event_id": result.SourceEventID,
				"job_id":          result.JobID,
				"output_key":      result.OutputKey,
				"projected_rows":  result.InsertedRows,
				"expected_rows":   result.ExpectedRows,
				"status":          "ready",
				"producer":        "go-api",
			})
			if err != nil {
				_ = message.NakWithDelay(5 * time.Second)
				continue
			}
			if err := nc.Publish(predictionProjectedLive, livePayload); err != nil {
				s.log.Warn("Prediction projected SSE signal failed", "error", err)
				_ = message.NakWithDelay(5 * time.Second)
				continue
			}
			if err := nc.FlushTimeout(5 * time.Second); err != nil {
				s.log.Warn("Prediction projected SSE flush failed", "error", err)
				_ = message.NakWithDelay(5 * time.Second)
				continue
			}
			if err := message.AckSync(nats.Context(ctx)); err != nil {
				s.log.Warn("Prediction completion ACK failed", "job_id", result.JobID, "error", err)
			}
		}
	}
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
		JobID         string `json:"job_id"`
		TrainingJobID string `json:"training_job_id"`
		Task          string `json:"task"`
		TicketID      string `json:"ticket_id"`
	}
	if len(msg.Data) > 0 {
		_ = json.Unmarshal(msg.Data, &meta)
		if meta.JobID != "" {
			event.JobID = meta.JobID
		} else if meta.TrainingJobID != "" {
			event.JobID = meta.TrainingJobID
		}
		if meta.TicketID != "" {
			event.TicketID = meta.TicketID
		}
	}

	// 1. Apply runtime state before notifying SSE subscribers so a dashboard
	// refresh always observes the event that triggered it.
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
	case strings.HasPrefix(subject, "aurora.live.ml."):
		s.handleMLEvent(ctx, msg, event)
	case strings.HasPrefix(subject, "aurora.v1.preprocessing."):
		s.handlePreprocessingEvent(ctx, msg, event)
	case strings.HasPrefix(subject, "aurora.live.gold."):
		s.handleGoldEvent(ctx, msg, event)
	}

	if s.broker != nil {
		_ = s.broker.Publish(ctx, event)
	}
}

func (s *NATSStream) handleBronzeEvent(_ context.Context, msg *nats.Msg, _ entity.WorkflowEvent) {
	s.log.Debug("Processing Bronze event from stream", "subject", msg.Subject)
}

func (s *NATSStream) handleSilverEvent(_ context.Context, msg *nats.Msg, _ entity.WorkflowEvent) {
	s.log.Debug("Processing Silver event from stream", "subject", msg.Subject)
}

func (s *NATSStream) handleGoldEvent(ctx context.Context, msg *nats.Msg, _ entity.WorkflowEvent) {
	s.log.Debug("Processing Gold event from stream", "subject", msg.Subject)
	if msg.Subject != "aurora.v1.gold.candidate.committed" || s.championInference == nil {
		return
	}
	var committed struct {
		SnapshotID string `json:"snapshot_id"`
	}
	if err := json.Unmarshal(msg.Data, &committed); err != nil || committed.SnapshotID == "" {
		s.log.Warn("Gold commit cannot trigger champion inference", "error", err)
		return
	}
	dispatched, err := s.championInference.EnsureChampionCoverage(ctx, committed.SnapshotID)
	if err != nil {
		s.log.Error("Champion inference planning failed for committed Gold snapshot", "snapshot_id", committed.SnapshotID, "error", err)
		return
	}
	if dispatched > 0 {
		s.log.Info("Champion inference dispatched for committed Gold snapshot", "snapshot_id", committed.SnapshotID, "jobs", dispatched)
	}
}

func (s *NATSStream) handleInferenceEvent(_ context.Context, msg *nats.Msg, event entity.WorkflowEvent) {
	s.log.Info("Inference event received", "subject", msg.Subject, "job_id", event.JobID)
}

func (s *NATSStream) handleMLEvent(_ context.Context, msg *nats.Msg, event entity.WorkflowEvent) {
	s.log.Info("ML training event received", "subject", msg.Subject, "job_id", event.JobID)
	if msg.Subject != "aurora.live.ml.promotion.progress" || s.championInference == nil {
		return
	}
	var promotion struct {
		Status string `json:"status"`
		Phase  string `json:"phase"`
	}
	if json.Unmarshal(msg.Data, &promotion) == nil && promotion.Status == "completed" && promotion.Phase == "completed" {
		go s.reconcileChampionInference()
	}
}

func (s *NATSStream) reconcileChampionInference() {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	dispatched, err := s.championInference.ReconcileChampionCoverage(ctx)
	if err != nil {
		s.log.Error("Champion inference reconciliation completed with errors", "dispatched_jobs", dispatched, "error", err)
		return
	}
	if dispatched > 0 {
		s.log.Info("Champion inference reconciliation dispatched missing jobs", "jobs", dispatched)
	}
}

func (s *NATSStream) handlePreprocessingEvent(_ context.Context, msg *nats.Msg, _ entity.WorkflowEvent) {
	if msg.Subject == "aurora.v1.preprocessing.runtime" && s.preprocessing != nil {
		var runtime entity.PreprocessingRuntimeEvent
		if err := json.Unmarshal(msg.Data, &runtime); err != nil {
			s.log.Warn("Invalid preprocessing runtime event", "error", err)
			return
		}
		s.preprocessing.ObserveRuntime(runtime)
		return
	}
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
	if s.projectorCancel != nil {
		s.projectorCancel()
	}
	if s.projectorSub != nil {
		_ = s.projectorSub.Unsubscribe()
	}
	projectorDone := s.projectorDone
	s.projectorCancel = nil
	s.projectorSub = nil
	s.projectorDone = nil
	s.mu.Unlock()
	if projectorDone != nil {
		select {
		case <-projectorDone:
		case <-time.After(2 * time.Second):
		}
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
