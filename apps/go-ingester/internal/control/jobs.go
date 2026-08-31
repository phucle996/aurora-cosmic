// Package control owns the ingestion control-plane contract and volatile job
// lifecycle. It never creates production adapters or processes FITS data.
package control

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
)

type StartRequest struct {
	ManifestPath string `json:"manifest_path"`
	Sector       int    `json:"sector"`
	Limit        int    `json:"limit"`
	Concurrency  int    `json:"concurrency"`
	Resume       bool   `json:"resume"`
	Fresh        bool   `json:"fresh"`
}

type Command struct {
	JobID        string
	ManifestPath string
	Sector       int
	Limit        int
	Concurrency  int
	Resume       bool
	Fresh        bool
}

type Job struct {
	ID           string    `json:"job_id"`
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

type JobManager struct {
	parent             context.Context
	defaultConcurrency int
	runner             Runner

	mu     sync.RWMutex
	active *activeJob
}

type activeJob struct {
	Job
	cancel context.CancelFunc
	done   chan struct{}
}

func NewJobManager(parent context.Context, defaultConcurrency int, runner Runner) *JobManager {
	if parent == nil {
		parent = context.Background()
	}
	if defaultConcurrency < 1 {
		defaultConcurrency = 1
	}
	return &JobManager{
		parent:             parent,
		defaultConcurrency: defaultConcurrency,
		runner:             runner,
	}
}

func (m *JobManager) Start(request StartRequest) (*Job, error) {
	command, err := m.commandFromRequest(request)
	if err != nil {
		return nil, err
	}
	if m.runner == nil {
		return nil, fmt.Errorf("ingestion runner is not configured")
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	if m.active != nil && isActive(m.active.Status) {
		return nil, ErrJobAlreadyRunning
	}

	now := time.Now().UTC()
	jobCtx, cancel := context.WithCancel(m.parent)
	command.JobID = "ingest-job-" + uuid.NewString()[:8]
	m.active = &activeJob{
		Job: Job{
			ID:           command.JobID,
			Status:       "running",
			ManifestPath: displayManifestPath(command),
			Sector:       command.Sector,
			Concurrency:  command.Concurrency,
			StartedAt:    now,
			UpdatedAt:    now,
		},
		cancel: cancel,
		done:   make(chan struct{}),
	}
	job := m.snapshotLocked()
	go m.run(jobCtx, command)
	return job, nil
}

func (m *JobManager) Current() *Job {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.snapshotLocked()
}

func (m *JobManager) Cancel(id string) (*Job, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.active == nil || !matchesJob(id, m.active.ID) {
		return nil, ErrJobNotFound
	}
	if m.active.Status == "running" {
		m.active.Status = "cancelling"
		m.active.UpdatedAt = time.Now().UTC()
		m.active.cancel()
	}
	return m.snapshotLocked(), nil
}

// Wait blocks until the active job has observed cancellation or completed.
// It lets process shutdown preserve the pipeline's final checkpoint flush.
func (m *JobManager) Wait(ctx context.Context) error {
	m.mu.RLock()
	if m.active == nil || !isActive(m.active.Status) {
		m.mu.RUnlock()
		return nil
	}
	done := m.active.done
	m.mu.RUnlock()

	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (m *JobManager) run(ctx context.Context, command Command) {
	err := m.runner.Run(ctx, command)

	m.mu.Lock()
	defer m.mu.Unlock()
	if m.active == nil || m.active.ID != command.JobID {
		return
	}
	m.active.UpdatedAt = time.Now().UTC()
	switch {
	case errors.Is(err, context.Canceled), ctx.Err() != nil:
		m.active.Status = "canceled"
	case err != nil:
		m.active.Status = "failed"
		m.active.Error = err.Error()
	default:
		m.active.Status = "completed"
	}
	close(m.active.done)
}

func (m *JobManager) commandFromRequest(request StartRequest) (Command, error) {
	if request.ManifestPath == "" && request.Sector <= 0 {
		return Command{}, fmt.Errorf("manifest_path or sector is required")
	}
	if request.Limit < 0 {
		return Command{}, fmt.Errorf("limit must be zero or greater")
	}
	if request.Concurrency <= 0 {
		request.Concurrency = m.defaultConcurrency
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

func (m *JobManager) snapshotLocked() *Job {
	if m.active == nil {
		return nil
	}
	job := m.active.Job
	return &job
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
	return status == "running" || status == "cancelling"
}

func matchesJob(id, activeID string) bool {
	return id == "" || id == "active" || id == "current" || id == activeID
}

var (
	ErrJobAlreadyRunning = errors.New("an ingest job is already running")
	ErrJobNotFound       = errors.New("ingest job not found")
)
