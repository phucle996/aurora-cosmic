// Package control owns the ingestion control-plane contract and volatile execution lifecycle.
// It never creates production adapters or processes FITS data.
package control

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

type StartRequest struct {
	TicketID     string `json:"ticket_id,omitempty"`
	ManifestPath string `json:"manifest_path"`
	Sector       int    `json:"sector"`
	Limit        int    `json:"limit"`
	Concurrency  int    `json:"concurrency"`
	Resume       bool   `json:"resume"`
	Fresh        bool   `json:"fresh"`
}

type Command struct {
	TicketID     string
	ManifestPath string
	Sector       int
	Limit        int
	Concurrency  int
	Resume       bool
	Fresh        bool
	// Drain is closed by an operator stop after the data plane has started.
	// Workers must stop claiming new products while allowing an already-claimed
	// product to reach durable storage and checkpoint completion.
	Drain <-chan struct{}
	// ReportRunning is called by the runner immediately before data-plane
	// ingestion begins. The control plane owns the resulting state transition.
	ReportRunning func()
}

type Execution struct {
	TicketID     string    `json:"ticket_id"`
	Status       string    `json:"status"`
	ManifestPath string    `json:"manifest_path,omitempty"`
	Sector       int       `json:"sector,omitempty"`
	Concurrency  int       `json:"concurrency,omitempty"`
	StartedAt    time.Time `json:"started_at"`
	UpdatedAt    time.Time `json:"updated_at"`
	Error        string    `json:"error,omitempty"`
}

type Runner interface {
	Run(context.Context, Command) error
}

type Controller struct {
	parent             context.Context
	defaultConcurrency int
	runner             Runner

	mu     sync.RWMutex
	active *activeExecution
}

type activeExecution struct {
	Execution
	cancel    context.CancelFunc
	drain     chan struct{}
	drainOnce sync.Once
	done      chan struct{}
}

func NewController(parent context.Context, defaultConcurrency int, runner Runner) *Controller {
	if parent == nil {
		parent = context.Background()
	}
	if defaultConcurrency < 1 {
		defaultConcurrency = 1
	}
	return &Controller{
		parent:             parent,
		defaultConcurrency: defaultConcurrency,
		runner:             runner,
	}
}

func (c *Controller) Start(request StartRequest) (*Execution, error) {
	command, err := c.commandFromRequest(request)
	if err != nil {
		return nil, err
	}
	if c.runner == nil {
		return nil, fmt.Errorf("ingestion runner is not configured")
	}

	c.mu.Lock()
	defer c.mu.Unlock()
	if c.active != nil && isActive(c.active.Status) {
		return nil, ErrAlreadyRunning
	}

	now := time.Now().UTC()
	execCtx, cancel := context.WithCancel(c.parent)
	drain := make(chan struct{})
	ticketID := strings.TrimSpace(request.TicketID)
	if ticketID == "" {
		ticketID = fmt.Sprintf("tic-ingest-%s", strings.ToLower(uuid.NewString()[:8]))
	}

	command.TicketID = ticketID
	command.Drain = drain
	command.ReportRunning = func() { c.markRunning(command.TicketID) }
	c.active = &activeExecution{
		Execution: Execution{
			TicketID:     ticketID,
			Status:       "planning",
			ManifestPath: displayManifestPath(command),
			Sector:       command.Sector,
			Concurrency:  command.Concurrency,
			StartedAt:    now,
			UpdatedAt:    now,
		},
		cancel: cancel,
		drain:  drain,
		done:   make(chan struct{}),
	}
	exec := c.snapshotLocked()
	go c.run(execCtx, command)
	return exec, nil
}

func (c *Controller) Current() *Execution {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.snapshotLocked()
}

func (c *Controller) Cancel(ticketID string) (*Execution, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	ticketID = strings.TrimSpace(ticketID)
	if c.active == nil || ticketID == "" || c.active.TicketID != ticketID {
		return nil, ErrTicketNotFound
	}
	if c.active.Status == "planning" {
		c.active.Status = "cancelling"
		c.active.UpdatedAt = time.Now().UTC()
		c.active.cancel()
	} else if c.active.Status == "running" {
		c.active.Status = "draining"
		c.active.UpdatedAt = time.Now().UTC()
		c.active.drainOnce.Do(func() { close(c.active.drain) })
	}
	return c.snapshotLocked(), nil
}

func (c *Controller) markRunning(ticketID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.active == nil || c.active.TicketID != ticketID || c.active.Status != "planning" {
		return
	}
	c.active.Status = "running"
	c.active.UpdatedAt = time.Now().UTC()
}

// Wait blocks until the active execution has observed cancellation or completed.
func (c *Controller) Wait(ctx context.Context) error {
	c.mu.RLock()
	if c.active == nil || !isActive(c.active.Status) {
		c.mu.RUnlock()
		return nil
	}
	done := c.active.done
	c.mu.RUnlock()

	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (c *Controller) run(ctx context.Context, command Command) {
	c.mu.RLock()
	var done chan struct{}
	if c.active != nil && c.active.TicketID == command.TicketID {
		done = c.active.done
	}
	c.mu.RUnlock()
	if done != nil {
		defer close(done)
	}

	err := c.runner.Run(ctx, command)

	c.mu.Lock()
	defer c.mu.Unlock()
	if c.active == nil || c.active.TicketID != command.TicketID {
		return
	}
	c.active.UpdatedAt = time.Now().UTC()
	switch {
	case errors.Is(err, context.Canceled), ctx.Err() != nil:
		c.active.Status = "canceled"
	case err != nil:
		c.active.Status = "failed"
		c.active.Error = err.Error()
	case c.active.Status == "draining":
		c.active.Status = "stopped"
	default:
		c.active.Status = "completed"
	}
}

func (c *Controller) commandFromRequest(request StartRequest) (Command, error) {
	if request.ManifestPath == "" && request.Sector <= 0 {
		return Command{}, fmt.Errorf("manifest_path or sector is required")
	}
	if request.Limit < 0 {
		return Command{}, fmt.Errorf("limit must be zero or greater")
	}
	if request.Concurrency <= 0 {
		request.Concurrency = c.defaultConcurrency
	}
	return Command{
		ManifestPath: request.ManifestPath,
		Sector:       request.Sector,
		Limit:        request.Limit,
		Concurrency:  request.Concurrency,
		Resume:       request.Resume,
		Fresh:        request.Fresh,
	}, nil
}

func (c *Controller) snapshotLocked() *Execution {
	if c.active == nil {
		return nil
	}
	exec := c.active.Execution
	return &exec
}

func displayManifestPath(command Command) string {
	if command.ManifestPath != "" {
		return command.ManifestPath
	}
	limit := "all"
	if command.Limit > 0 {
		limit = fmt.Sprintf("%d", command.Limit)
	}
	return fmt.Sprintf("remote:tess/sector=%d/limit=%s", command.Sector, limit)
}

func isActive(status string) bool {
	return status == "planning" || status == "running" || status == "cancelling" || status == "draining"
}

var (
	ErrAlreadyRunning = errors.New("an ingest execution is already running")
	ErrTicketNotFound = errors.New("ingest ticket not found")
)
