package stream

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/nats-io/nats.go"
	"go-api/internal/domain/service"
)

const (
	inferenceStreamName       = "AURORA_INFERENCE"
	inferenceCompletionFilter = "aurora.v1.inference.*.completed"
	predictionProjectorName   = "aurora-analytics-projector-v1"
)

// Config defines dependencies and configuration for StreamConsumer.
type Config struct {
	Conn                *nats.Conn
	NATSURL             string
	PredictionProjector service.PredictionProjector
	Logger              *slog.Logger
}

// StreamConsumer manages durable JetStream consumer subscriptions
// and runs background workers for reliable event/prediction ingestion.
type StreamConsumer struct {
	predictions service.PredictionProjector
	log         *slog.Logger
	natsURL     string

	mu              sync.Mutex
	conn            *nats.Conn
	ownsConn        bool
	projectorSub    *nats.Subscription
	projectorCancel context.CancelFunc
	projectorDone   chan struct{}
}

// New khởi tạo StreamConsumer với fail-fast check tại thời điểm khởi động
func New(cfg Config) *StreamConsumer {
	logger := cfg.Logger
	if logger == nil {
		logger = slog.Default()
	}
	ownsConn := false
	if cfg.Conn == nil && cfg.NATSURL == "" {
		panic("stream: either NATS Conn or NATSURL is required")
	}
	if cfg.Conn == nil {
		ownsConn = true
	}

	return &StreamConsumer{
		predictions: cfg.PredictionProjector,
		log:         logger,
		natsURL:     cfg.NATSURL,
		conn:        cfg.Conn,
		ownsConn:    ownsConn,
	}
}

// SetConn assigns an existing NATS connection to avoid duplicate TCP dials (zero connection overhead).
func (c *StreamConsumer) SetConn(conn *nats.Conn) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.conn == nil && conn != nil {
		c.conn = conn
		c.ownsConn = false
	}
}

// Start establishes or binds the JetStream consumer and starts the background worker.
func (c *StreamConsumer) Start(ctx context.Context) error {
	if c.predictions == nil {
		// If predictions service is not configured, stream consumer has no jobs to process
		return nil
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	if c.conn == nil {
		nc, err := nats.Connect(c.natsURL,
			nats.Timeout(5*time.Second),
			nats.Name("aurora-api-jetstream-consumer"),
			nats.DisconnectErrHandler(func(_ *nats.Conn, err error) {
				if err != nil {
					c.log.Warn("NATS stream consumer disconnected", "error", err)
				}
			}),
			nats.ReconnectHandler(func(conn *nats.Conn) {
				c.log.Info("NATS stream consumer reconnected", "url", conn.ConnectedUrl())
			}),
		)
		if err != nil {
			return fmt.Errorf("stream: connect NATS at %s: %w", c.natsURL, err)
		}
		c.conn = nc
		c.ownsConn = true
	}

	nc := c.conn
	js, err := nc.JetStream()
	if err != nil {
		return fmt.Errorf("stream: create JetStream context: %w", err)
	}

	// Ensure inference stream exists
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

	// Ensure durable pull consumer exists
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
	c.projectorSub = subscription
	c.projectorCancel = cancel
	c.projectorDone = make(chan struct{})

	go c.runPredictionProjector(projectorCtx, nc, subscription, c.projectorDone)
	return nil
}

// Close gracefully cancels the projector worker, unsubscribes and closes connection if owned.
func (c *StreamConsumer) Close() error {
	c.mu.Lock()
	if c.projectorCancel != nil {
		c.projectorCancel()
	}
	if c.projectorSub != nil {
		_ = c.projectorSub.Unsubscribe()
	}
	projectorDone := c.projectorDone
	c.projectorCancel = nil
	c.projectorSub = nil
	c.projectorDone = nil
	c.mu.Unlock()

	if projectorDone != nil {
		select {
		case <-projectorDone:
		case <-time.After(2 * time.Second):
		}
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	if c.ownsConn && c.conn != nil && !c.conn.IsClosed() {
		c.conn.Close()
		c.conn = nil
	}
	return nil
}
