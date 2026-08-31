package control

import (
	"context"
	"errors"
	"testing"
	"time"
)

type blockingRunner struct {
	started chan Command
}

func (r blockingRunner) Run(ctx context.Context, command Command) error {
	r.started <- command
	<-ctx.Done()
	return ctx.Err()
}

func TestJobManagerEnforcesSingleFlightAndCancelsRun(t *testing.T) {
	runner := blockingRunner{started: make(chan Command, 1)}
	manager := NewJobManager(context.Background(), 4, runner)

	job, err := manager.Start(StartRequest{Sector: 42})
	if err != nil {
		t.Fatalf("start job: %v", err)
	}
	if job.Status != "running" || job.Concurrency != 4 {
		t.Fatalf("unexpected started job: %+v", job)
	}
	command := <-runner.started
	if command.JobID != job.ID || command.Sector != 42 {
		t.Fatalf("runner received unexpected command: %+v", command)
	}

	if _, err := manager.Start(StartRequest{Sector: 43}); !errors.Is(err, ErrJobAlreadyRunning) {
		t.Fatalf("expected single-flight rejection, got %v", err)
	}

	cancelled, err := manager.Cancel("active")
	if err != nil {
		t.Fatalf("cancel job: %v", err)
	}
	if cancelled.Status != "cancelling" {
		t.Fatalf("expected cancelling state, got %q", cancelled.Status)
	}

	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		current := manager.Current()
		if current != nil && current.Status == "canceled" {
			if err := manager.Wait(context.Background()); err != nil {
				t.Fatalf("wait for canceled job: %v", err)
			}
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("job never reached canceled state: %+v", manager.Current())
}

func TestJobManagerValidatesStartRequest(t *testing.T) {
	manager := NewJobManager(context.Background(), 2, blockingRunner{started: make(chan Command, 1)})

	for _, request := range []StartRequest{
		{},
		{Sector: 1, Limit: -1},
	} {
		if _, err := manager.Start(request); err == nil {
			t.Fatalf("expected invalid request rejection for %+v", request)
		}
	}
}
