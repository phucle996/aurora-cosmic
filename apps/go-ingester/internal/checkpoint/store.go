package checkpoint

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"path"
	"time"

	"go-ingester/internal/storage"
)

const (
	CurrentPointerKey = "checkpoints/ingestion/current.json"
	RunsPrefix        = "checkpoints/ingestion/runs"
)

// Store manages persistent ingestion progress checkpoints in MinIO.
type Store struct {
	minioClient storage.Client
	bucket      string
}

// NewStore constructs a Checkpoint Store.
func NewStore(minioClient storage.Client, bucket string) *Store {
	return &Store{
		minioClient: minioClient,
		bucket:      bucket,
	}
}

// RunKey generates the object key for a specific run checkpoint.
func RunKey(runID string) string {
	return path.Join(RunsPrefix, fmt.Sprintf("%s.json", runID))
}

// Save serializes checkpoint to JSON and saves both run checkpoint and current pointer object in MinIO.
func (s *Store) Save(ctx context.Context, cp *Checkpoint) error {
	cp.UpdatedAt = time.Now().UTC()

	data, err := json.MarshalIndent(cp, "", "  ")
	if err != nil {
		return fmt.Errorf("checkpoint: marshal run %s: %w", cp.RunID, err)
	}

	runKey := RunKey(cp.RunID)
	meta := map[string]string{
		"run-id":         cp.RunID,
		"schema-version": fmt.Sprintf("%d", cp.SchemaVersion),
		"status":         string(cp.Status),
	}

	// Save run checkpoint file
	err = s.minioClient.PutObject(ctx, s.bucket, runKey, bytes.NewReader(data), int64(len(data)), meta)
	if err != nil {
		return fmt.Errorf("checkpoint: put run object %s: %w", runKey, err)
	}

	// Update current pointer object
	ptr := CurrentPointer{
		RunID:         cp.RunID,
		Status:        cp.Status,
		CheckpointKey: runKey,
		UpdatedAt:     cp.UpdatedAt,
	}
	ptrData, err := json.MarshalIndent(ptr, "", "  ")
	if err != nil {
		return fmt.Errorf("checkpoint: marshal current pointer: %w", err)
	}

	err = s.minioClient.PutObject(ctx, s.bucket, CurrentPointerKey, bytes.NewReader(ptrData), int64(len(ptrData)), nil)
	if err != nil {
		return fmt.Errorf("checkpoint: put current pointer object: %w", err)
	}

	return nil
}

// Load reads a run checkpoint from MinIO given its runID.
func (s *Store) Load(ctx context.Context, runID string) (*Checkpoint, error) {
	runKey := RunKey(runID)
	return s.loadKey(ctx, runKey)
}

// LoadCurrent reads the current pointer file and loads the latest checkpoint if present.
// Returns nil, false, nil if no current checkpoint exists.
func (s *Store) LoadCurrent(ctx context.Context) (*Checkpoint, bool, error) {
	info, exists, err := s.minioClient.StatObject(ctx, s.bucket, CurrentPointerKey)
	if err != nil || !exists || info.Size == 0 {
		return nil, false, nil
	}

	// Fetch current pointer
	var ptr CurrentPointer
	err = s.fetchJSON(ctx, CurrentPointerKey, &ptr)
	if err != nil {
		return nil, false, fmt.Errorf("checkpoint: read current pointer: %w", err)
	}

	if ptr.CheckpointKey == "" {
		return nil, false, nil
	}

	cp, err := s.loadKey(ctx, ptr.CheckpointKey)
	if err != nil {
		return nil, false, err
	}
	return cp, true, nil
}

func (s *Store) loadKey(ctx context.Context, key string) (*Checkpoint, error) {
	_, exists, err := s.minioClient.StatObject(ctx, s.bucket, key)
	if err != nil {
		return nil, fmt.Errorf("checkpoint: stat %s: %w", key, err)
	}
	if !exists {
		return nil, fmt.Errorf("checkpoint: %s does not exist", key)
	}

	var cp Checkpoint
	if err := s.fetchJSON(ctx, key, &cp); err != nil {
		return nil, err
	}

	if cp.SchemaVersion != SchemaVersion {
		return nil, fmt.Errorf("checkpoint: unsupported schema version %d in %s (expected %d)", cp.SchemaVersion, key, SchemaVersion)
	}

	return &cp, nil
}

func (s *Store) fetchJSON(ctx context.Context, key string, v any) error {
	reader, err := s.minioClient.GetObject(ctx, s.bucket, key)
	if err != nil {
		return fmt.Errorf("checkpoint: get object %s: %w", key, err)
	}
	defer reader.Close()

	if err := json.NewDecoder(reader).Decode(v); err != nil {
		return fmt.Errorf("checkpoint: decode json %s: %w", key, err)
	}
	return nil
}
