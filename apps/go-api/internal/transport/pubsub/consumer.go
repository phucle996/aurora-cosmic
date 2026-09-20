package pubsub

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/nats-io/nats.go"
	"go-api/internal/domain/service"
	"go-api/internal/provider"
)

// MessageHandler is a callback invoked when a message arrives on a subscribed subject.
type MessageHandler func(ctx context.Context, msg *nats.Msg) error

// Config holds dependencies and configuration for NATSPubSub.
type Config struct {
	Conn              *nats.Conn
	NATSURL           string
	Broker            *provider.SSEBroker
	DAGAggregation    service.DAGAggregation
	ChampionInference service.ChampionInferencePlanner
	ModelNew          service.ModelNew
	Logger            *slog.Logger
}

// NATSPubSub manages Core NATS ephemeral push-subscriptions and routes
// real-time events to the SSE broker and internal domain service callbacks.
type NATSPubSub struct {
	broker            *provider.SSEBroker
	dagAggregation    service.DAGAggregation
	championInference service.ChampionInferencePlanner
	modelNew          service.ModelNew
	log               *slog.Logger
	natsURL           string

	mu             sync.Mutex
	conn           *nats.Conn
	ownsConn       bool
	subscriptions  []*nats.Subscription
	customHandlers map[string][]MessageHandler
}

// New khởi tạo thể hiện NATSPubSub với fail-fast validation tại thời điểm khởi động
func New(cfg Config) *NATSPubSub {
	if cfg.Broker == nil {
		panic("pubsub: SSEBroker is required")
	}
	logger := cfg.Logger
	if logger == nil {
		logger = slog.Default()
	}
	ownsConn := false
	if cfg.Conn == nil && cfg.NATSURL == "" {
		panic("pubsub: either NATS Conn or NATSURL is required")
	}
	if cfg.Conn == nil {
		ownsConn = true
	}

	return &NATSPubSub{
		broker:            cfg.Broker,
		dagAggregation:    cfg.DAGAggregation,
		championInference: cfg.ChampionInference,
		modelNew:          cfg.ModelNew,
		log:               logger,
		natsURL:           cfg.NATSURL,
		conn:              cfg.Conn,
		ownsConn:          ownsConn,
		customHandlers:    make(map[string][]MessageHandler),
	}
}

// RegisterHandler registers a custom callback for a specific subject or pattern.
func (p *NATSPubSub) RegisterHandler(subject string, handler MessageHandler) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.customHandlers[subject] = append(p.customHandlers[subject], handler)
}

// Conn returns the underlying NATS connection for sharing across consumers.
func (p *NATSPubSub) Conn() *nats.Conn {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.conn
}

// Start connects to NATS (if not already provided) and registers all default push-subscriptions.
func (p *NATSPubSub) Start(ctx context.Context) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.conn == nil {
		nc, err := nats.Connect(p.natsURL,
			nats.Timeout(5*time.Second),
			nats.Name("aurora-api-pubsub-consumer"),
			nats.DisconnectErrHandler(func(_ *nats.Conn, err error) {
				if err != nil {
					p.log.Warn("NATS pubsub consumer disconnected", "error", err)
				}
			}),
			nats.ReconnectHandler(func(c *nats.Conn) {
				p.log.Info("NATS pubsub consumer reconnected", "url", c.ConnectedUrl())
			}),
		)
		if err != nil {
			return fmt.Errorf("pubsub: connect NATS at %s: %w", p.natsURL, err)
		}
		p.conn = nc
		p.ownsConn = true
	}

	nc := p.conn

	defaultSubjects := []string{
		"aurora.v1.bronze.>",
		"aurora.v1.silver.>",
		"aurora.v1.gold.>",
		"aurora.v1.inference.>",
		"aurora.v1.ml.>",
		"aurora.v1.preprocessing.control",
		"aurora.v1.preprocessing.runtime",
		"aurora.live.gold.>",
		"aurora.live.ml.>",
	}

	for _, subject := range defaultSubjects {
		sub, err := nc.Subscribe(subject, p.makeMsgHandler())
		if err != nil {
			p.log.Error("Failed to subscribe to subject", "subject", subject, "error", err)
			continue
		}
		p.subscriptions = append(p.subscriptions, sub)
		p.log.Info("Subscribed to Core NATS subject", "subject", subject)
	}

	flushCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := nc.FlushWithContext(flushCtx); err != nil {
		for _, sub := range p.subscriptions {
			_ = sub.Unsubscribe()
		}
		p.subscriptions = nil
		if p.ownsConn {
			nc.Close()
			p.conn = nil
		}
		return fmt.Errorf("pubsub: flush subscriptions: %w", err)
	}

	// Register custom handlers subscriptions
	for subject, handlers := range p.customHandlers {
		sub, err := nc.Subscribe(subject, func(msg *nats.Msg) {
			reqCtx, reqCancel := context.WithTimeout(ctx, 10*time.Second)
			defer reqCancel()
			for _, h := range handlers {
				if err := h(reqCtx, msg); err != nil {
					p.log.Error("Custom message handler failed", "subject", msg.Subject, "error", err)
				}
			}
		})
		if err != nil {
			p.log.Error("Failed to subscribe custom subject", "subject", subject, "error", err)
			continue
		}
		p.subscriptions = append(p.subscriptions, sub)
	}

	return nil
}

func (p *NATSPubSub) makeMsgHandler() nats.MsgHandler {
	return func(msg *nats.Msg) {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		p.dispatchMessage(ctx, msg)
	}
}

// Close gracefully unsubscribes from all subjects and closes connection if owned.
func (p *NATSPubSub) Close() error {
	p.mu.Lock()
	defer p.mu.Unlock()

	for _, sub := range p.subscriptions {
		_ = sub.Unsubscribe()
	}
	p.subscriptions = nil

	if p.ownsConn && p.conn != nil && !p.conn.IsClosed() {
		p.conn.Close()
		p.conn = nil
	}
	return nil
}
