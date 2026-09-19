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

func TestControllerEnforcesSingleFlightAndDrainsRunningWork(t *testing.T) {
	runner := drainingRunner{started: make(chan Command, 1), release: make(chan struct{})}
	ctrl := NewController(context.Background(), 4, runner)

	exec, err := ctrl.Start(StartRequest{Sector: 42})
	if err != nil {
		t.Fatalf("start execution: %v", err)
	}
	if exec.Status != "planning" || exec.Concurrency != 4 {
		t.Fatalf("unexpected started execution: %+v", exec)
	}
	command := <-runner.started
	if command.TicketID != exec.TicketID || command.Sector != 42 {
		t.Fatalf("runner received unexpected command: %+v", command)
	}
	if current := ctrl.Current(); current == nil || current.Status != "running" {
		t.Fatalf("expected runner to transition execution to running, got %+v", current)
	}

	if _, err := ctrl.Start(StartRequest{Sector: 43}); !errors.Is(err, ErrAlreadyRunning) {
		t.Fatalf("expected single-flight rejection, got %v", err)
	}

	// Rejects cancel when ticket ID does not match
	if _, err := ctrl.Cancel("invalid-ticket"); !errors.Is(err, ErrTicketNotFound) {
		t.Fatalf("expected ErrTicketNotFound, got %v", err)
	}

	cancelled, err := ctrl.Cancel(exec.TicketID)
	if err != nil {
		t.Fatalf("cancel execution: %v", err)
	}
	if cancelled.Status != "draining" {
		t.Fatalf("expected draining state, got %q", cancelled.Status)
	}
	select {
	case <-command.Drain:
	default:
		t.Fatal("running execution did not receive the drain signal")
	}
	if current := ctrl.Current(); current == nil || current.Status != "draining" {
		t.Fatalf("execution left draining before current work completed: %+v", current)
	}
	close(runner.release)

	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		current := ctrl.Current()
		if current != nil && current.Status == "stopped" {
			if err := ctrl.Wait(context.Background()); err != nil {
				t.Fatalf("wait for stopped execution: %v", err)
			}
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("execution never reached stopped state: %+v", ctrl.Current())
}

func TestControllerCancelsPlanningImmediately(t *testing.T) {
	runner := blockingRunner{started: make(chan Command, 1)}
	ctrl := NewController(context.Background(), 1, runner)
	exec, err := ctrl.Start(StartRequest{Sector: 1})
	if err != nil {
		t.Fatalf("start execution: %v", err)
	}
	<-runner.started
	stopping, err := ctrl.Cancel(exec.TicketID)
	if err != nil || stopping.Status != "cancelling" {
		t.Fatalf("planning cancel state=%+v err=%v", stopping, err)
	}
	if err := ctrl.Wait(context.Background()); err != nil {
		t.Fatalf("wait for planning cancellation: %v", err)
	}
	if current := ctrl.Current(); current == nil || current.Status != "canceled" {
		t.Fatalf("expected canceled planning execution, got %+v", current)
	}
}

func TestControllerValidatesStartRequest(t *testing.T) {
	ctrl := NewController(context.Background(), 2, blockingRunner{started: make(chan Command, 1)})

	for _, request := range []StartRequest{
		{},
		{Sector: 1, Limit: -1},
	} {
		if _, err := ctrl.Start(request); err == nil {
			t.Fatalf("expected invalid request rejection for %+v", request)
		}
	}
}
