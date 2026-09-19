package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"go-api/internal/domain/entity"
	domainService "go-api/internal/domain/service"
	"go-api/internal/provider"
)

const (
	// Storage keys for operator control and live worker status.
	enrichmentControlKey       = "control/enrichment.json"
	enrichmentRuntimeStatusKey = "control/enrichment/status.json"

	// Guardrail validation constraints for enrichment runtime controls.
	minEnrichmentIdleFlush = 60
	maxEnrichmentIdleFlush = 900
	maxEnrichmentBatchSize = 5000
)

// EnrichmentControlService manages the operator control plane and manifest queries
// for the enrichment (Silver → Gold) pipeline.
type EnrichmentControlService struct {
	objects   provider.ObjectStorage
	publisher provider.EventPublisher
}

// NewEnrichmentControlService creates a new EnrichmentControl domain service instance.
func NewEnrichmentControlService(objects provider.ObjectStorage, publisher provider.EventPublisher) domainService.EnrichmentControl {
	return &EnrichmentControlService{
		objects:   objects,
		publisher: publisher,
	}
}

// GetControlOverview aggregates the complete status of the enrichment subsystem:
//  1. Desired Operator Control State (from control/enrichment.json): mode (STREAM/BATCH/PAUSED),
//     configured limits (max_batch_records, idle_flush_seconds), and active ticket ID.
//  2. Observed Worker Runtime Telemetry (from control/enrichment/status.json): current worker state,
//     individual worker slot progress (7 steps pipeline), readiness gates (contracted vs missing TPF),
//     and catalog synchronization status (TIC/TOI cache hits, snapshot IDs).
func (s *EnrichmentControlService) GetControlOverview(ctx context.Context) (*entity.EnrichmentControlOverview, error) {
	// 1. Fetch persisted operator control state from durable object storage.
	data, err := s.objects.GetObject(ctx, enrichmentControlKey)
	if err != nil {
		return nil, fmt.Errorf("read enrichment control: %w", err)
	}

	var control entity.EnrichmentControlState
	if err := json.Unmarshal(data, &control); err != nil {
		return nil, fmt.Errorf("decode enrichment control: %w", err)
	}

	// 2. Validate control state invariants and guardrails.
	control.Mode = strings.ToUpper(strings.TrimSpace(control.Mode))
	if control.Mode != "PAUSED" && control.Mode != "STREAM" && control.Mode != "BATCH" {
		return nil, fmt.Errorf("enrichment control has unsupported mode %q", control.Mode)
	}

	if control.IdleFlushSeconds != 0 && (control.IdleFlushSeconds < minEnrichmentIdleFlush || control.IdleFlushSeconds > maxEnrichmentIdleFlush) {
		return nil, fmt.Errorf("enrichment control has invalid idle_flush_seconds %v: must be between %d and %d", control.IdleFlushSeconds, minEnrichmentIdleFlush, maxEnrichmentIdleFlush)
	}

	if control.MaxBatchRecords != 0 && (control.MaxBatchRecords < 1 || control.MaxBatchRecords > maxEnrichmentBatchSize) {
		return nil, fmt.Errorf("enrichment control has invalid max_batch_records %d: must be between 1 and %d", control.MaxBatchRecords, maxEnrichmentBatchSize)
	}

	if control.Mode != "PAUSED" {
		if control.IdleFlushSeconds < minEnrichmentIdleFlush || control.IdleFlushSeconds > maxEnrichmentIdleFlush {
			return nil, fmt.Errorf("running enrichment control requires valid idle_flush_seconds between %d and %d", minEnrichmentIdleFlush, maxEnrichmentIdleFlush)
		}
		if control.MaxBatchRecords < 1 || control.MaxBatchRecords > maxEnrichmentBatchSize {
			return nil, fmt.Errorf("running enrichment control requires valid max_batch_records between 1 and %d", maxEnrichmentBatchSize)
		}
	}

	overview := &entity.EnrichmentControlOverview{
		Control: control,
	}

	// 3. Inspect live worker runtime telemetry if present (non-fatal if absent).
	runtimeData, err := s.objects.GetObject(ctx, enrichmentRuntimeStatusKey)
	if err == nil && len(runtimeData) > 0 {
		var runtime entity.EnrichmentRuntimeStatus
		if err := json.Unmarshal(runtimeData, &runtime); err != nil {
			return nil, fmt.Errorf("decode enrichment runtime status: %w", err)
		}
		overview.Runtime = &runtime
	} else if err != nil && !errors.Is(err, provider.ErrObjectNotFound) {
		return nil, fmt.Errorf("read enrichment runtime status: %w", err)
	}

	return overview, nil
}

// Start dispatches a start command (STREAM or BATCH mode) to the enrichment subsystem:
//  1. Persists the desired operator state into object storage (control/enrichment.json).
//  2. Broadcasts a workflow event to NATS JetStream (gold:<ticket_id>) to trigger workers.
func (s *EnrichmentControlService) Start(ctx context.Context, request entity.EnrichmentControlStartRequest) (*entity.EnrichmentCommandResult, error) {
	// 1. Build and serialize new durable control state.
	control := entity.EnrichmentControlState{
		SchemaVersion:    1,
		Mode:             request.Mode,
		MaxBatchRecords:  request.MaxBatchRecords,
		IdleFlushSeconds: float64(request.IdleFlushSeconds),
		TicketID:         request.TicketID,
		UpdatedAt:        time.Now().UTC(),
	}

	data, err := json.Marshal(control)
	if err != nil {
		return nil, fmt.Errorf("encode enrichment control: %w", err)
	}

	// 2. Commit control record to object storage.
	if err := s.objects.PutObject(ctx, enrichmentControlKey, data, "application/json"); err != nil {
		return nil, fmt.Errorf("write enrichment control: %w", err)
	}

	// 3. Publish control transition event to the message bus if wired.
	if s.publisher != nil {
		topic := "gold:" + request.TicketID
		eventData, _ := json.Marshal(map[string]any{
			"type":        "workflow",
			"topic":       topic,
			"workflow":    "enrichment",
			"status":      "armed",
			"ticket_id":   request.TicketID,
			"occurred_at": control.UpdatedAt,
			"payload":     control,
		})
		_ = s.publisher.Publish(ctx, topic, provider.Event{
			Type:  "workflow",
			Topic: topic,
			Data:  eventData,
		})
	}

	return &entity.EnrichmentCommandResult{
		TicketID: request.TicketID,
		Status:   "armed",
	}, nil
}

// Stop requests the enrichment pipeline to pause:
//  1. Reads the current control state to preserve batch sizes, flush intervals, and ticket ID.
//  2. Commits Mode = "PAUSED" to durable object storage.
//  3. Emits a pause_requested event on the topic.
func (s *EnrichmentControlService) Stop(ctx context.Context) (*entity.EnrichmentCommandResult, error) {
	// 1. Read existing control state from storage to retain current operational configuration.
	data, err := s.objects.GetObject(ctx, enrichmentControlKey)
	if err != nil {
		return nil, fmt.Errorf("read enrichment control: %w", err)
	}

	var previous entity.EnrichmentControlState
	if err := json.Unmarshal(data, &previous); err != nil {
		return nil, fmt.Errorf("decode enrichment control: %w", err)
	}

	// 2. Prepare and persist paused state.
	control := entity.EnrichmentControlState{
		SchemaVersion:    1,
		Mode:             "PAUSED",
		MaxBatchRecords:  previous.MaxBatchRecords,
		IdleFlushSeconds: previous.IdleFlushSeconds,
		TicketID:         previous.TicketID,
		UpdatedAt:        time.Now().UTC(),
	}

	data, err = json.Marshal(control)
	if err != nil {
		return nil, fmt.Errorf("encode enrichment control: %w", err)
	}

	if err := s.objects.PutObject(ctx, enrichmentControlKey, data, "application/json"); err != nil {
		return nil, fmt.Errorf("write enrichment control: %w", err)
	}

	// 3. Publish pause command event to the event stream.
	if s.publisher != nil {
		topic := "gold"
		if control.TicketID != "" {
			topic = "gold:" + control.TicketID
		}
		eventData, _ := json.Marshal(map[string]any{
			"type":        "workflow",
			"topic":       topic,
			"workflow":    "enrichment",
			"status":      "pause_requested",
			"ticket_id":   control.TicketID,
			"occurred_at": control.UpdatedAt,
			"payload":     control,
		})
		_ = s.publisher.Publish(ctx, topic, provider.Event{
			Type:  "workflow",
			Topic: topic,
			Data:  eventData,
		})
	}

	return &entity.EnrichmentCommandResult{
		TicketID: control.TicketID,
		Status:   "pause_requested",
	}, nil
}

// Snapshot loads and returns the detailed manifest for a specific gold snapshot ID.
func (s *EnrichmentControlService) Snapshot(ctx context.Context, snapshotID string) (*entity.EnrichmentSnapshotDetail, error) {
	snapshotID = strings.TrimSpace(snapshotID)
	if !strings.HasPrefix(snapshotID, "gold-v1-") || strings.Contains(snapshotID, "/") {
		return nil, fmt.Errorf("invalid snapshot id")
	}

	manifestPath := "gold/snapshots/" + snapshotID + "/manifest.json"
	data, err := s.objects.GetObject(ctx, manifestPath)
	if err != nil {
		if errors.Is(err, provider.ErrObjectNotFound) {
			return nil, fmt.Errorf("snapshot %s was not found", snapshotID)
		}
		return nil, fmt.Errorf("read snapshot manifest: %w", err)
	}

	var snapshot entity.EnrichmentSnapshotDetail
	if err := json.Unmarshal(data, &snapshot); err != nil {
		return nil, fmt.Errorf("decode snapshot manifest: %w", err)
	}

	if snapshot.SnapshotID != snapshotID {
		return nil, fmt.Errorf("manifest snapshot id does not match requested id")
	}

	if snapshot.FeatureVersions == nil {
		snapshot.FeatureVersions = map[string]string{}
	}
	if snapshot.DatasetRowCounts == nil {
		snapshot.DatasetRowCounts = map[string]int{}
	}

	return &snapshot, nil
}

// ListSnapshots retrieves the latest committed gold snapshot summaries up to the given limit,
// sorted by last modified timestamp descending.
func (s *EnrichmentControlService) ListSnapshots(ctx context.Context, limit int) ([]entity.EnrichmentSnapshotSummary, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}

	// 1. List all snapshot directory objects under gold/snapshots/.
	objects, err := s.objects.ListObjects(ctx, "gold/snapshots/")
	if err != nil {
		return nil, fmt.Errorf("list manifests: %w", err)
	}

	// 2. Filter for gold-v1 manifest files.
	manifests := make([]provider.ObjectInfo, 0, len(objects))
	for _, object := range objects {
		if strings.HasPrefix(object.Key, "gold/snapshots/gold-v1-") && strings.HasSuffix(object.Key, "/manifest.json") {
			manifests = append(manifests, object)
		}
	}

	// 3. Sort manifests descending by last modification time and clamp to limit.
	sort.Slice(manifests, func(i, j int) bool {
		return manifests[i].LastModified.After(manifests[j].LastModified)
	})
	if len(manifests) > limit {
		manifests = manifests[:limit]
	}

	// 4. Parse each manifest to assemble lightweight snapshot summary records.
	summaries := make([]entity.EnrichmentSnapshotSummary, 0, len(manifests))
	for _, manifest := range manifests {
		data, readErr := s.objects.GetObject(ctx, manifest.Key)
		if readErr != nil {
			return nil, fmt.Errorf("read manifest %s: %w", manifest.Key, readErr)
		}

		var snapshot entity.EnrichmentSnapshotDetail
		if decodeErr := json.Unmarshal(data, &snapshot); decodeErr != nil {
			return nil, fmt.Errorf("decode manifest %s: %w", manifest.Key, decodeErr)
		}

		if snapshot.SnapshotID == "" {
			return nil, fmt.Errorf("manifest %s does not declare a snapshot id", manifest.Key)
		}

		var sizeBytes int64
		for _, artifact := range snapshot.Artifacts {
			sizeBytes += artifact.SizeBytes
		}

		summaries = append(summaries, entity.EnrichmentSnapshotSummary{
			SnapshotID:   snapshot.SnapshotID,
			ManifestKey:  manifest.Key,
			SizeBytes:    sizeBytes,
			LastModified: manifest.LastModified.UTC().Format(time.RFC3339),
			CreatedAt:    snapshot.CreatedAt,
			Status:       snapshot.Status,
		})
	}

	return summaries, nil
}
