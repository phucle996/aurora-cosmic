package service

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
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
}

// NewModelNewService initializes a new ModelNewService instance.
func NewModelNewService(objects provider.ObjectStorage, natsClient *nats.Client, modelRepo repo.ModelNewRepository) domainService.ModelNew {
	return &ModelNewService{
		objects: objects,
		nats:    natsClient,
		repo:    modelRepo,
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

	return &entity.TrainingControlResult{
		TicketID:  spec.TicketID,
		Action:    spec.Action,
		Status:    "dispatched",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}, nil
}
