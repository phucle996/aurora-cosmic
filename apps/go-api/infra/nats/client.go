package nats

import (
	"context"
	"fmt"
	"time"

	"github.com/nats-io/nats.go"
)

type Dispatcher struct{ URL string }

func NewDispatcher(url string) *Dispatcher { return &Dispatcher{URL: url} }

func (d *Dispatcher) Dispatch(ctx context.Context, task string, payload []byte) error {
	subject, err := subjectForTask(task)
	if err != nil {
		return err
	}
	connectCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	nc, err := nats.Connect(d.URL, nats.Timeout(5*time.Second))
	if err != nil {
		return fmt.Errorf("connect NATS: %w", err)
	}
	defer nc.Close()
	if err := nc.Publish(subject, payload); err != nil {
		return fmt.Errorf("publish inference request: %w", err)
	}
	if err := nc.FlushWithContext(connectCtx); err != nil {
		return fmt.Errorf("flush inference request: %w", err)
	}
	return nil
}

func subjectForTask(task string) (string, error) {
	switch task {
	case "candidate_vetting":
		return "aurora.v1.inference.candidate.requested", nil
	case "astronomical_anomaly_detection":
		return "aurora.v1.inference.anomaly.requested", nil
	default:
		return "", fmt.Errorf("unsupported inference task %q", task)
	}
}
