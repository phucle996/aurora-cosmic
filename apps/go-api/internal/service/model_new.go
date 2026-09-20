package service

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"go-api/infra/nats"
	"go-api/internal/domain/entity"
	"go-api/internal/domain/repo"
	domainService "go-api/internal/domain/service"
	"go-api/internal/provider"
	"go-api/internal/taxonomy"

	natsio "github.com/nats-io/nats.go"
)

// ModelNewService implements domainService.ModelNew for Model domain workflows.
type ModelNewService struct {
	objects provider.ObjectStorage
	nats    *nats.Client
	repo    repo.ModelNewRepository

	mu          sync.RWMutex
	activeRuns  map[string]*entity.TrainingActiveState
	recentOrder []string
}

// NewModelNewService initializes a new ModelNewService instance.
func NewModelNewService(objects provider.ObjectStorage, natsClient *nats.Client, modelRepo repo.ModelNewRepository) domainService.ModelNew {
	return &ModelNewService{
		objects:     objects,
		nats:        natsClient,
		repo:        modelRepo,
		activeRuns:  make(map[string]*entity.TrainingActiveState),
		recentOrder: make([]string, 0),
	}
}

// TrainingPreflight verifies that the selected Gold snapshots are committed in object storage
// and evaluates their supervised learning readiness and class balance against ClickHouse.
func (s *ModelNewService) TrainingPreflight(ctx context.Context, snapshotIDs []string) (*entity.TrainingPreflight, error) {
	// 1. Verify existence of Gold snapshots in Object Storage (MinIO)
	for _, id := range snapshotIDs {
		if _, err := s.objects.GetObject(ctx, "gold/snapshots/"+id+"/manifest.json"); err != nil {
			if errors.Is(err, provider.ErrObjectNotFound) {
				return nil, fmt.Errorf("%w: Gold snapshot %s was not found in object storage", taxonomy.ErrInvalidRequest, id)
			}
			return nil, fmt.Errorf("read Gold snapshot %s: %w", id, err)
		}
	}

	// 2. Delegate to repository
	preflight, err := s.repo.TrainingPreflight(ctx, snapshotIDs)
	if err != nil {
		return nil, err
	}
	return preflight, nil
}

// ListTrainingSnapshots retrieves the latest indexed Gold snapshots with candidate cohort metrics from the repository.
func (s *ModelNewService) ListTrainingSnapshots(ctx context.Context, limit int) ([]entity.ModelTrainingSnapshot, error) {
	snapshots, err := s.repo.ListTrainingSnapshots(ctx, limit)
	if err != nil {
		return nil, err
	}
	return snapshots, nil
}

// StartTraining validates readiness via the Preflight Gate and dispatches the training run to NATS JetStream.
func (s *ModelNewService) StartTraining(ctx context.Context, spec entity.StartTrainingSpec) (*entity.TrainingResult, error) {
	if s.nats == nil {
		return nil, errors.New("training dispatcher is unavailable")
	}

	// 1. Mandatory Preflight Gate check
	preflight, err := s.TrainingPreflight(ctx, spec.SnapshotIDs)
	if err != nil {
		return nil, err
	}
	if preflight.Tier == "BLOCKED" {
		return nil, fmt.Errorf("%w: Gold snapshot cohort does not meet minimum supervised training requirements (tier: %s)", taxonomy.ErrInvalidRequest, preflight.Tier)
	}

	// 2. Dispatch training request to JetStream using ticket_id as first-class identity
	createdAt := time.Now().UTC().Format(time.RFC3339)
	payload, err := json.Marshal(map[string]any{
		"ticket_id":         spec.TicketID,
		"task":              spec.Task,
		"gold_snapshot_ids": spec.SnapshotIDs,
		"training_mode":     spec.TrainingMode,
		"base_model_id":     spec.BaseModelID,
		"compute_target":    spec.ComputeTarget,
		"epochs":            spec.Epochs,
		"batch_size":        spec.BatchSize,
		"learning_rate":     spec.LearningRate,
		"seed":              spec.Seed,
		"auto_promote":      false,
		"created_at":        createdAt,
	})
	if err != nil {
		return nil, fmt.Errorf("marshal training request: %w", err)
	}

	subject := "aurora.v1.ml.training.requested"
	message := natsio.NewMsg(subject)
	message.Data = payload
	digest := sha256.Sum256(append(append([]byte(subject+":"), payload...), byte(0)))
	message.Header.Set(natsio.MsgIdHdr, fmt.Sprintf("%x", digest[:]))
	if err := s.nats.PublishDurable(ctx, message); err != nil {
		return nil, fmt.Errorf("publish durable request: %w", err)
	}

	// 3. Register in soft state tracker
	s.mu.Lock()
	state := &entity.TrainingActiveState{
		TicketID:        spec.TicketID,
		Task:            spec.Task,
		SnapshotCount:   len(spec.SnapshotIDs),
		BaseModelID:     spec.BaseModelID,
		ComputeTarget:   spec.ComputeTarget,
		Status:          "queued",
		Phase:           "queued",
		ProgressPercent: 0,
		CurrentEpoch:    0,
		TotalEpochs:     spec.Epochs,
		LossHistory:     make([]entity.LossPoint, 0),
		Logs: []entity.TrainingLogEntry{
			{
				Timestamp: createdAt,
				Message:   fmt.Sprintf("Training run %s queued for dispatch (%s branch)", spec.TicketID, spec.ComputeTarget),
				Level:     "info",
			},
		},
		StartedAt: time.Now().UTC().UnixMilli(),
		UpdatedAt: createdAt,
	}
	s.activeRuns[spec.TicketID] = state
	s.recentOrder = append(s.recentOrder, spec.TicketID)
	if len(s.recentOrder) > 50 {
		evict := s.recentOrder[0]
		s.recentOrder = s.recentOrder[1:]
		delete(s.activeRuns, evict)
	}
	s.mu.Unlock()

	return &entity.TrainingResult{
		TicketID:      spec.TicketID,
		Task:          spec.Task,
		SnapshotIDs:   spec.SnapshotIDs,
		TrainingMode:  spec.TrainingMode,
		BaseModelID:   spec.BaseModelID,
		ComputeTarget: spec.ComputeTarget,
		Status:        "queued",
		CreatedAt:     createdAt,
		Message:       fmt.Sprintf("Training run %s queued for dispatch (%s branch).", spec.TicketID, spec.ComputeTarget),
	}, nil
}

// ControlTraining publishes an intervention signal (cancel or checkpoint) for an in-flight training run.
func (s *ModelNewService) ControlTraining(ctx context.Context, spec entity.TrainingControlSpec) (*entity.TrainingControlResult, error) {
	payload, err := json.Marshal(map[string]string{
		"ticket_id": spec.TicketID,
		"action":    spec.Action,
	})
	if err != nil {
		return nil, fmt.Errorf("marshal training control payload: %w", err)
	}

	subject := "aurora.v1.ml.training.control"
	if err := s.nats.Publish(ctx, subject, payload); err != nil {
		return nil, fmt.Errorf("publish training control signal: %w", err)
	}

	// Update in-flight state immediately for fast feedback
	nowStr := time.Now().UTC().Format(time.RFC3339)
	s.mu.Lock()
	if st, ok := s.activeRuns[spec.TicketID]; ok {
		msg := fmt.Sprintf("Operator issued control action: %s", spec.Action)
		lvl := "warn"
		if spec.Action == "cancel" {
			st.Status = "cancelling"
		}
		st.Logs = append(st.Logs, entity.TrainingLogEntry{
			Timestamp: nowStr,
			Message:   msg,
			Level:     lvl,
		})
		st.UpdatedAt = nowStr
	}
	s.mu.Unlock()

	return &entity.TrainingControlResult{
		TicketID:  spec.TicketID,
		Action:    spec.Action,
		Status:    "dispatched",
		Timestamp: nowStr,
	}, nil
}

// GetActiveTraining queries the in-memory soft state for an active training run or latest run.
func (s *ModelNewService) GetActiveTraining(_ context.Context, ticketID string) (*entity.TrainingActiveState, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	ticketID = strings.TrimSpace(ticketID)
	if ticketID != "" {
		if state, exists := s.activeRuns[ticketID]; exists {
			cp := *state
			cp.LossHistory = append([]entity.LossPoint(nil), state.LossHistory...)
			cp.Logs = append([]entity.TrainingLogEntry(nil), state.Logs...)
			return &cp, nil
		}
		return nil, nil
	}

	// If no ticketID specified, find the latest running or queued run
	for i := len(s.recentOrder) - 1; i >= 0; i-- {
		tid := s.recentOrder[i]
		if state, ok := s.activeRuns[tid]; ok {
			if state.Status == "running" || state.Status == "queued" || state.Status == "cancelling" {
				cp := *state
				cp.LossHistory = append([]entity.LossPoint(nil), state.LossHistory...)
				cp.Logs = append([]entity.TrainingLogEntry(nil), state.Logs...)
				return &cp, nil
			}
		}
	}

	// If no active run, return the most recent run
	if len(s.recentOrder) > 0 {
		lastID := s.recentOrder[len(s.recentOrder)-1]
		if state, ok := s.activeRuns[lastID]; ok {
			cp := *state
			cp.LossHistory = append([]entity.LossPoint(nil), state.LossHistory...)
			cp.Logs = append([]entity.TrainingLogEntry(nil), state.Logs...)
			return &cp, nil
		}
	}

	return nil, nil
}

// ObserveTrainingProgress updates the in-memory soft state when worker telemetry arrives.
func (s *ModelNewService) ObserveTrainingProgress(_ context.Context, event map[string]any) error {
	ticketID, _ := event["ticket_id"].(string)
	ticketID = strings.TrimSpace(ticketID)
	if ticketID == "" {
		return nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	state, exists := s.activeRuns[ticketID]
	if !exists {
		task, _ := event["task"].(string)
		state = &entity.TrainingActiveState{
			TicketID:    ticketID,
			Task:        task,
			Status:      "running",
			Phase:       "training",
			StartedAt:   time.Now().UTC().UnixMilli(),
			LossHistory: make([]entity.LossPoint, 0),
			Logs:        make([]entity.TrainingLogEntry, 0),
		}
		s.activeRuns[ticketID] = state
		s.recentOrder = append(s.recentOrder, ticketID)
	}

	if st, ok := event["status"].(string); ok && st != "" {
		state.Status = st
	}
	if ph, ok := event["phase"].(string); ok && ph != "" {
		state.Phase = ph
	}
	if p, ok := event["progress_percent"].(float64); ok {
		state.ProgressPercent = p
	}
	if ep, ok := event["current_epoch"].(float64); ok {
		state.CurrentEpoch = int(ep)
	} else if ep, ok := event["current_epoch"].(int); ok {
		state.CurrentEpoch = ep
	}
	if tot, ok := event["total_epochs"].(float64); ok {
		state.TotalEpochs = int(tot)
	} else if tot, ok := event["total_epochs"].(int); ok {
		state.TotalEpochs = tot
	}
	if bep, ok := event["best_epoch"].(float64); ok {
		state.BestEpoch = int(bep)
	} else if bep, ok := event["best_epoch"].(int); ok {
		state.BestEpoch = bep
	}
	if bvl, ok := event["best_val_loss"].(float64); ok {
		state.BestValLoss = bvl
	}
	if tl, ok := event["train_loss"].(float64); ok {
		state.TrainLoss = tl
	}
	if vl, ok := event["val_loss"].(float64); ok {
		state.ValLoss = vl
	}
	if errStr, ok := event["error"].(string); ok && errStr != "" {
		state.Error = errStr
	}

	// Append epoch loss history
	if state.CurrentEpoch > 0 && event["val_loss"] != nil {
		point := entity.LossPoint{
			Epoch:     state.CurrentEpoch,
			TrainLoss: state.TrainLoss,
			ValLoss:   state.ValLoss,
			IsBest:    state.CurrentEpoch == state.BestEpoch,
		}
		existsIdx := -1
		for i, lp := range state.LossHistory {
			if lp.Epoch == point.Epoch {
				existsIdx = i
				break
			}
		}
		if existsIdx >= 0 {
			state.LossHistory[existsIdx] = point
		} else {
			state.LossHistory = append(state.LossHistory, point)
		}
	}

	state.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	return nil
}

// ObserveTrainingLog appends an in-flight log entry from the worker.
func (s *ModelNewService) ObserveTrainingLog(_ context.Context, ticketID string, entry entity.TrainingLogEntry) error {
	ticketID = strings.TrimSpace(ticketID)
	if ticketID == "" {
		return nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	state, exists := s.activeRuns[ticketID]
	if !exists {
		return nil
	}

	if entry.Timestamp == "" {
		entry.Timestamp = time.Now().UTC().Format(time.RFC3339)
	}
	state.Logs = append(state.Logs, entry)
	if len(state.Logs) > 200 {
		state.Logs = state.Logs[len(state.Logs)-200:]
	}
	state.UpdatedAt = entry.Timestamp
	return nil
}
