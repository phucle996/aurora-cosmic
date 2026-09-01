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

type drainingRunner struct {
	started chan Command
	release chan struct{}
}

func (r drainingRunner) Run(_ context.Context, command Command) error {
	command.ReportRunning()
	r.started <- command
	<-command.Drain
	<-r.release
	return nil
}

func TestJobManagerEnforcesSingleFlightAndDrainsRunningWork(t *testing.T) {
	runner := drainingRunner{started: make(chan Command, 1), release: make(chan struct{})}
	manager := NewJobManager(context.Background(), 4, runner)

	job, err := manager.Start(StartRequest{Sector: 42})
	if err != nil {
		t.Fatalf("start job: %v", err)
	}
	if job.Status != "planning" || job.Concurrency != 4 {
		t.Fatalf("unexpected started job: %+v", job)
	}
	command := <-runner.started
	if command.JobID != job.ID || command.Sector != 42 {
		t.Fatalf("runner received unexpected command: %+v", command)
	}
	if current := manager.Current(); current == nil || current.Status != "running" {
		t.Fatalf("expected runner to transition job to running, got %+v", current)
	}

	if _, err := manager.Start(StartRequest{Sector: 43}); !errors.Is(err, ErrJobAlreadyRunning) {
		t.Fatalf("expected single-flight rejection, got %v", err)
	}

	cancelled, err := manager.Cancel("active")
	if err != nil {
		t.Fatalf("cancel job: %v", err)
	}
	if cancelled.Status != "draining" {
		t.Fatalf("expected draining state, got %q", cancelled.Status)
	}
	select {
	case <-command.Drain:
	default:
		t.Fatal("running job did not receive the drain signal")
	}
	if current := manager.Current(); current == nil || current.Status != "draining" {
		t.Fatalf("job left draining before current work completed: %+v", current)
	}
	close(runner.release)

	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		current := manager.Current()
		if current != nil && current.Status == "stopped" {
			if err := manager.Wait(context.Background()); err != nil {
				t.Fatalf("wait for stopped job: %v", err)
			}
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("job never reached stopped state: %+v", manager.Current())
}

func TestJobManagerCancelsPlanningImmediately(t *testing.T) {
	runner := blockingRunner{started: make(chan Command, 1)}
	manager := NewJobManager(context.Background(), 1, runner)
	job, err := manager.Start(StartRequest{Sector: 1})
	if err != nil {
		t.Fatalf("start job: %v", err)
	}
	<-runner.started
	stopping, err := manager.Cancel(job.ID)
	if err != nil || stopping.Status != "cancelling" {
		t.Fatalf("planning cancel state=%+v err=%v", stopping, err)
	}
	if err := manager.Wait(context.Background()); err != nil {
		t.Fatalf("wait for planning cancellation: %v", err)
	}
	if current := manager.Current(); current == nil || current.Status != "canceled" {
		t.Fatalf("expected canceled planning job, got %+v", current)
	}
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
