package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"go-api/infra/nats"
	"go-api/internal/domain/entity"
	domainService "go-api/internal/domain/service"
	"go-api/internal/provider"
)

// PreprocessingService manages job lifecycle for the Rust Preprocessor.
// It is strictly a domain job controller (Start, Stop, GetActiveJob).
// It does not maintain DAG visual graphs, worker telemetry snapshots, or progress counters.
type PreprocessingService struct {
	nats       *nats.Client            // NATS client to send control commands
	publisher  provider.EventPublisher // Workflow event publisher
	objects    provider.ObjectStorage  // Object storage to inspect checkpoints
	runtimeMu  sync.RWMutex            // Protects runtimeJob in RAM
	runtimeJob *entity.PreprocessingControlJob
}

// NewPreprocessingService creates a new PreprocessingService.
func NewPreprocessingService(natsClient *nats.Client, publisher provider.EventPublisher, objects provider.ObjectStorage) domainService.Preprocessing {
	return &PreprocessingService{
		nats:      natsClient,
		publisher: publisher,
		objects:   objects,
	}
}

// Start dispatches a start command for preprocessing.
func (s *PreprocessingService) Start(ctx context.Context, request entity.PreprocessingStartRequest) (*entity.PreprocessingControlJob, error) {
	request.TicketID = strings.TrimSpace(request.TicketID)
	if request.TicketID == "" {
		return nil, errors.New("ticket_id is required")
	}

	mode := strings.ToLower(strings.TrimSpace(request.Mode))
	if mode == "" {
		mode = "stream"
	}
	if mode != "stream" && mode != "batch" {
		return nil, fmt.Errorf("mode %q is not supported: must be stream or batch", request.Mode)
	}

	workerCount := request.WorkerCount
	if workerCount <= 0 {
		workerCount = 1
	}

	s.runtimeMu.RLock()
	if s.runtimeJob != nil && (s.runtimeJob.Status == "running" || s.runtimeJob.Status == "accepted" || s.runtimeJob.Status == "cancelling") {
		activeTicketID := s.runtimeJob.TicketID
		s.runtimeMu.RUnlock()
		return nil, fmt.Errorf("preprocessing ticket %q is still active (cannot start %q)", activeTicketID, request.TicketID)
	}
	s.runtimeMu.RUnlock()

	job := &entity.PreprocessingControlJob{
		TicketID:    request.TicketID,
		Status:      "accepted",
		Mode:        mode,
		WorkerCount: workerCount,
		IngestRunID: strings.TrimSpace(request.IngestRunID),
		Prefix:      strings.TrimSpace(request.Prefix),
		StartedAt:   time.Now().UTC(),
		UpdatedAt:   time.Now().UTC(),
	}

	command := map[string]any{
		"action":        "START",
		"ticket_id":     job.TicketID,
		"mode":          job.Mode,
		"worker_count":  job.WorkerCount,
		"ingest_run_id": job.IngestRunID,
		"prefix":        job.Prefix,
		"requested_at":  job.StartedAt,
	}

	if s.nats != nil {
		commandBytes, _ := json.Marshal(command)
		if err := s.nats.Publish(ctx, "aurora.v1.preprocessing.control", commandBytes); err != nil {
			return nil, fmt.Errorf("publish preprocessing start command: %w", err)
		}
	}

	job.Status = "running"
	s.runtimeMu.Lock()
	s.runtimeJob = job
	s.runtimeMu.Unlock()

	if s.publisher != nil {
		topic := "preprocessing:" + job.TicketID
		data, _ := json.Marshal(map[string]any{
			"type":        "workflow",
			"topic":       topic,
			"workflow":    "preprocessing",
			"status":      job.Status,
			"ticket_id":   job.TicketID,
			"occurred_at": job.UpdatedAt,
			"payload":     job,
		})
		_ = s.publisher.Publish(ctx, topic, provider.Event{
			Type:  "workflow",
			Topic: topic,
			Data:  data,
		})
	}
	return job, nil
}

// Stop sends a stop command for an active preprocessing job.
func (s *PreprocessingService) Stop(ctx context.Context, ticketID string) (*entity.PreprocessingControlJob, error) {
	ticketID = strings.TrimSpace(ticketID)
	if ticketID == "" {
		return nil, errors.New("ticket_id is required")
	}

	s.runtimeMu.Lock()
	if s.runtimeJob != nil && s.runtimeJob.TicketID != ticketID {
		s.runtimeMu.Unlock()
		return nil, fmt.Errorf("preprocessing ticket %q is not active", ticketID)
	}

	job := entity.PreprocessingControlJob{
		TicketID:    ticketID,
		Status:      "cancelling",
		Mode:        "stream",
		WorkerCount: 1,
		StartedAt:   time.Now().UTC(),
		UpdatedAt:   time.Now().UTC(),
	}
	if s.runtimeJob != nil {
		job = *s.runtimeJob
		job.Status = "cancelling"
		job.UpdatedAt = time.Now().UTC()
	}
	s.runtimeJob = &job
	s.runtimeMu.Unlock()

	command := map[string]any{
		"action":       "STOP",
		"ticket_id":    ticketID,
		"requested_at": time.Now().UTC(),
	}
	if s.nats != nil {
		commandBytes, _ := json.Marshal(command)
		if err := s.nats.Publish(ctx, "aurora.v1.preprocessing.control", commandBytes); err != nil {
			return nil, fmt.Errorf("publish preprocessing stop command: %w", err)
		}
	}

	if s.publisher != nil {
		topic := "preprocessing:" + ticketID
		data, _ := json.Marshal(map[string]any{
			"type":        "workflow",
			"topic":       topic,
			"workflow":    "preprocessing",
			"status":      job.Status,
			"ticket_id":   job.TicketID,
			"occurred_at": job.UpdatedAt,
			"payload":     job,
		})
		_ = s.publisher.Publish(ctx, topic, provider.Event{
			Type:  "workflow",
			Topic: topic,
			Data:  data,
		})
	}
	return &job, nil
}

// GetActiveJob returns the current active preprocessing job if any.
func (s *PreprocessingService) GetActiveJob(ctx context.Context) (*entity.PreprocessingControlJob, error) {
	s.runtimeMu.RLock()
	job := s.runtimeJob
	s.runtimeMu.RUnlock()
	if job != nil {
		copy := *job
		return &copy, nil
	}

	// Check if there is an active run in checkpoints/preprocessing/current.json
	if s.objects != nil {
		if data, err := s.objects.GetObject(ctx, "checkpoints/preprocessing/current.json"); err == nil && len(data) > 0 {
			var pointer struct {
				ActiveRunID string `json:"active_run_id"`
			}
			if json.Unmarshal(data, &pointer) == nil && pointer.ActiveRunID != "" {
				if runData, runErr := s.objects.GetObject(ctx, "checkpoints/preprocessing/runs/"+pointer.ActiveRunID+".json"); runErr == nil {
					var cp struct {
						RunID       string    `json:"run_id"`
						Status      string    `json:"status"`
						Mode        string    `json:"mode"`
						IngestRunID string    `json:"ingest_run_id"`
						WorkerCount int       `json:"worker_count"`
						Prefix      string    `json:"prefix"`
						StartedAt   time.Time `json:"started_at"`
						UpdatedAt   time.Time `json:"updated_at"`
						Error       *string   `json:"error"`
					}
					if json.Unmarshal(runData, &cp) == nil && cp.RunID != "" {
						var errMsg string
						if cp.Error != nil {
							errMsg = *cp.Error
						}
						recovered := &entity.PreprocessingControlJob{
							TicketID:    cp.RunID,
							Status:      strings.ToLower(cp.Status),
							Mode:        cp.Mode,
							IngestRunID: cp.IngestRunID,
							WorkerCount: cp.WorkerCount,
							Prefix:      cp.Prefix,
							StartedAt:   cp.StartedAt,
							UpdatedAt:   cp.UpdatedAt,
							Error:       errMsg,
						}
						s.runtimeMu.Lock()
						s.runtimeJob = recovered
						s.runtimeMu.Unlock()
						return recovered, nil
					}
				}
			}
		}
	}
	return nil, nil
}
