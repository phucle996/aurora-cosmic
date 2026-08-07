package events

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"go-ingester/internal/mast"

	"github.com/nats-io/nats.go"
)

// Publisher defines the contract for publishing Bronze ingestion events.
type Publisher interface {
	PublishBronzeReady(ctx context.Context, evt *BronzeObjectReady) error
	Close()
}

// NATSPublisher implements Publisher using NATS JetStream.
type NATSPublisher struct {
	nc *nats.Conn
	js nats.JetStreamContext
}

// NewNATSPublisher connects to NATS and ensures the AURORA_BRONZE JetStream stream exists.
func NewNATSPublisher(natsURL string, timeout time.Duration) (*NATSPublisher, error) {
	nc, err := nats.Connect(natsURL, nats.Name("aurora-ingester"), nats.Timeout(timeout))
	if err != nil {
		return nil, fmt.Errorf("nats: connect to %s failed: %w", natsURL, err)
	}

	js, err := nc.JetStream()
	if err != nil {
		nc.Close()
		return nil, fmt.Errorf("nats: jetstream init failed: %w", err)
	}

	// Ensure stream AURORA_BRONZE exists.
	streamName := StreamBronze
	_, err = js.StreamInfo(streamName)
	if err != nil {
		_, err = js.AddStream(&nats.StreamConfig{
			Name:     streamName,
			Subjects: []string{"aurora.v1.bronze.*.ready"},
			Storage:  nats.FileStorage,
		})
		if err != nil {
			nc.Close()
			return nil, fmt.Errorf("nats: add stream %s failed: %w", streamName, err)
		}
	}

	return &NATSPublisher{
		nc: nc,
		js: js,
	}, nil
}

// PublishBronzeReady serialises and synchronously publishes a BronzeObjectReady event to JetStream.
func (p *NATSPublisher) PublishBronzeReady(ctx context.Context, evt *BronzeObjectReady) error {
	subject, err := SubjectForKind(mast.ProductKind(evt.ProductKind))
	if err != nil {
		return err
	}

	data, err := json.Marshal(evt)
	if err != nil {
		return fmt.Errorf("nats: marshal event: %w", err)
	}

	msg := &nats.Msg{
		Subject: subject,
		Data:    data,
		Header:  nats.Header{},
	}
	msg.Header.Set("Nats-Msg-Id", evt.EventID)

	_, err = p.js.PublishMsg(msg, nats.Context(ctx))
	if err != nil {
		return fmt.Errorf("nats: jetstream publish to %s failed: %w", subject, err)
	}

	return nil
}

// Close gracefully drains and closes the NATS connection.
func (p *NATSPublisher) Close() {
	if p.nc != nil {
		_ = p.nc.Drain()
		p.nc.Close()
	}
}
