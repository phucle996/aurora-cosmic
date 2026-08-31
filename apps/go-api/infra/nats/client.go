package nats

import (
	"context"
	"crypto/sha256"
	"fmt"
	"sync"
	"time"

	"github.com/nats-io/nats.go"
)

type Dispatcher struct {
	URL string

	mu sync.Mutex
	nc *nats.Conn
	js nats.JetStreamContext
}

func NewDispatcher(url string) *Dispatcher { return &Dispatcher{URL: url} }

func (d *Dispatcher) Dispatch(ctx context.Context, task string, payload []byte) error {
	subject, err := subjectForTask(task)
	if err != nil {
		return err
	}
	if task == "preprocessing_start" || task == "preprocessing_stop" {
		return d.publishCore(ctx, subject, payload)
	}
	js, err := d.jetStream(ctx)
	if err != nil {
		return err
	}
	if task == "training_start" || task == "ml_training" {
		stream := &nats.StreamConfig{
			Name:      "AURORA_ML",
			Subjects:  []string{"aurora.v1.ml.>"},
			Storage:   nats.FileStorage,
			Retention: nats.LimitsPolicy,
		}
		if _, streamErr := js.AddStream(stream); streamErr != nil {
			if _, streamErr = js.UpdateStream(stream); streamErr != nil {
				return fmt.Errorf("ensure ML JetStream: %w", streamErr)
			}
		}
	}
	message := nats.NewMsg(subject)
	message.Data = payload
	digest := sha256.Sum256(append(append([]byte(subject+":"), payload...), byte(0)))
	message.Header.Set(nats.MsgIdHdr, fmt.Sprintf("%x", digest[:]))
	if _, err := js.PublishMsg(message); err != nil {
		return fmt.Errorf("publish durable request: %w", err)
	}
	if err := d.flush(ctx); err != nil {
		return fmt.Errorf("flush inference request: %w", err)
	}
	return nil
}

// publishCore sends ephemeral control-plane commands directly to the live
// preprocessor subscriber. These commands are intentionally not retained:
// replaying an old start/stop command after a service restart would mutate the
// operator's current desired state.
func (d *Dispatcher) publishCore(ctx context.Context, subject string, payload []byte) error {
	if _, err := d.jetStream(ctx); err != nil {
		return err
	}
	d.mu.Lock()
	nc := d.nc
	d.mu.Unlock()
	if nc == nil || !nc.IsConnected() {
		return fmt.Errorf("NATS connection is unavailable")
	}
	if err := nc.Publish(subject, payload); err != nil {
		return fmt.Errorf("publish control command: %w", err)
	}
	if err := d.flush(ctx); err != nil {
		return fmt.Errorf("flush control command: %w", err)
	}
	return nil
}

func (d *Dispatcher) Ping(ctx context.Context) error {
	if _, err := d.jetStream(ctx); err != nil {
		return err
	}
	return d.flush(ctx)
}

func (d *Dispatcher) Close() error {
	if d == nil {
		return nil
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.nc != nil {
		d.nc.Drain()
		d.nc.Close()
		d.nc, d.js = nil, nil
	}
	return nil
}

func (d *Dispatcher) jetStream(ctx context.Context) (nats.JetStreamContext, error) {
	if d == nil || d.URL == "" {
		return nil, fmt.Errorf("NATS endpoint is unavailable")
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.nc != nil && d.nc.IsConnected() && d.js != nil {
		return d.js, nil
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	nc, err := nats.Connect(d.URL, nats.Timeout(5*time.Second))
	if err != nil {
		return nil, fmt.Errorf("connect NATS: %w", err)
	}
	js, err := nc.JetStream()
	if err != nil {
		nc.Close()
		return nil, fmt.Errorf("create JetStream context: %w", err)
	}
	d.nc, d.js = nc, js
	return js, nil
}

func (d *Dispatcher) flush(ctx context.Context) error {
	if d == nil {
		return fmt.Errorf("NATS endpoint is unavailable")
	}
	d.mu.Lock()
	nc := d.nc
	d.mu.Unlock()
	if nc == nil || !nc.IsConnected() {
		return fmt.Errorf("NATS connection is unavailable")
	}
	flushCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	return nc.FlushWithContext(flushCtx)
}

func subjectForTask(task string) (string, error) {
	switch task {
	case "candidate_vetting":
		return "aurora.v1.inference.candidate.requested", nil
	case "preprocessing_start":
		return "aurora.v1.preprocessing.control", nil
	case "preprocessing_stop":
		return "aurora.v1.preprocessing.control", nil
	case "training_start", "ml_training":
		return "aurora.v1.ml.training.requested", nil
	default:
		return "", fmt.Errorf("unsupported inference task %q", task)
	}
}
