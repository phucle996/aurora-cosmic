package events

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"go-ingester/internal/model"

	"github.com/nats-io/nats.go"
)

// NATSPublisher implements model.Publisher using NATS JetStream.
type NATSPublisher struct {
	nc *nats.Conn
	js nats.JetStreamContext
}

// NewNATSPublisher connects to NATS and ensures the Bronze and Silver event
// streams exist before the first product is published. Keeping both streams
// bootstrapped here makes a fresh Compose deployment safe regardless of which
// worker starts first.
func NewNATSPublisher(url string, timeout time.Duration) (*NATSPublisher, error) {
	if url == "" {
		url = nats.DefaultURL
	}

	nc, err := nats.Connect(url, nats.Timeout(timeout))
	if err != nil {
		return nil, fmt.Errorf("nats connect %s: %w", url, err)
	}

	js, err := nc.JetStream()
	if err != nil {
		nc.Close()
		return nil, fmt.Errorf("nats jetstream context: %w", err)
	}

	streams := []nats.StreamConfig{
		{
			Name:       model.StreamBronze,
			Subjects:   []string{"aurora.v1.bronze.>"},
			Storage:    nats.FileStorage,
			Retention:  nats.LimitsPolicy,
			Duplicates: 24 * time.Hour,
		},
		{
			Name:       model.StreamSilver,
			Subjects:   []string{"aurora.v1.silver.>"},
			Storage:    nats.FileStorage,
			Retention:  nats.LimitsPolicy,
			Duplicates: 24 * time.Hour,
		},
	}
	for _, streamConfig := range streams {
		config := streamConfig
		if _, err = js.AddStream(&config); err != nil {
			if _, err = js.UpdateStream(&config); err != nil {
				nc.Close()
				return nil, fmt.Errorf("nats ensure stream %s: %w", config.Name, err)
			}
		}
	}

	return &NATSPublisher{
		nc: nc,
		js: js,
	}, nil
}

// PublishBronzeReady publishes a BronzeObjectReady event synchronously.
func (p *NATSPublisher) PublishBronzeReady(ctx context.Context, evt *model.BronzeObjectReady) error {
	if evt == nil {
		return fmt.Errorf("nats: cannot publish nil event")
	}

	kind := model.ProductKind(evt.ProductKind)
	subject, err := model.SubjectForKind(kind)
	if err != nil {
		return fmt.Errorf("nats subject resolution: %w", err)
	}

	payload, err := json.Marshal(evt)
	if err != nil {
		return fmt.Errorf("nats marshal event %s: %w", evt.EventID, err)
	}

	msg := &nats.Msg{
		Subject: subject,
		Data:    payload,
		Header:  make(nats.Header),
	}
	msg.Header.Set("Nats-Msg-Id", evt.EventID)

	pubOpts := []nats.PubOpt{nats.Context(ctx)}
	_, err = p.js.PublishMsg(msg, pubOpts...)
	if err != nil {
		return fmt.Errorf("nats publish %s -> %s: %w", evt.EventID, subject, err)
	}

	return nil
}

// Close closes the underlying NATS connection gracefully.
func (p *NATSPublisher) Close() error {
	if p.nc != nil {
		p.nc.Close()
	}
	return nil
}
