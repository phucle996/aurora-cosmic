package inference

import (
	"context"
	"fmt"
	"time"

	"github.com/nats-io/nats.go"
)

// Dispatcher is the control-plane boundary used by HTTP handlers to enqueue
// an already committed inference manifest. The GPU worker remains the only
// component that executes model inference.
type Dispatcher interface {
	Dispatch(context.Context, string, []byte) error
}

type NATSDispatcher struct {
	url string
}

func NewNATSDispatcher(url string) *NATSDispatcher {
	return &NATSDispatcher{url: url}
}

func (d *NATSDispatcher) Dispatch(ctx context.Context, task string, payload []byte) error {
	subject, err := subjectForTask(task)
	if err != nil {
		return err
	}
	connectCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	nc, err := nats.Connect(d.url, nats.Timeout(5*time.Second))
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
