package checkpoint

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"time"

	"go-ingester/internal/model"
)

// Store handles JSON serialization and MinIO persistence for Checkpoint objects.
type Store struct {
	client model.Client
	bucket string
}

// NewStore constructs a Checkpoint Store.
func NewStore(client model.Client, bucket string) *Store {
	return &Store{
		client: client,
		bucket: bucket,
	}
}

// Save persists a Checkpoint to MinIO S3 and updates current.json pointer.
func (s *Store) Save(ctx context.Context, cp *model.Checkpoint) error {
	if cp == nil || cp.RunID == "" {
		return fmt.Errorf("checkpoint save: invalid run_id")
	}

	cp.UpdatedAt = time.Now().UTC()
	data, err := json.MarshalIndent(cp, "", "  ")
	if err != nil {
		return fmt.Errorf("checkpoint marshal: %w", err)
	}

	runKey := model.RunKey(cp.RunID)
	err = s.client.PutObject(ctx, s.bucket, runKey, bytes.NewReader(data), int64(len(data)), map[string]string{
		"run-id":        cp.RunID,
		"manifest-path": cp.ManifestPath,
	})
	if err != nil {
		return fmt.Errorf("checkpoint save run %s: %w", cp.RunID, err)
	}

	pointer := model.CurrentPointer{
		ActiveRunID:   cp.RunID,
		ManifestPath:  cp.ManifestPath,
		ManifestHash:  cp.ManifestHash,
		LastUpdatedAt: cp.UpdatedAt,
	}
	pointerData, err := json.MarshalIndent(pointer, "", "  ")
	if err != nil {
		return fmt.Errorf("pointer marshal: %w", err)
	}

	err = s.client.PutObject(ctx, s.bucket, model.PointerKey, bytes.NewReader(pointerData), int64(len(pointerData)), nil)
	if err != nil {
		return fmt.Errorf("checkpoint save pointer %s: %w", model.PointerKey, err)
	}

	return nil
}

// Load fetches a Checkpoint by runID from MinIO.
func (s *Store) Load(ctx context.Context, runID string) (*model.Checkpoint, bool, error) {
	runKey := model.RunKey(runID)
	cp, exists, err := s.fetchJSON(ctx, runKey)
	if err != nil || !exists {
		return nil, exists, err
	}
	var checkpoint model.Checkpoint
	if err := json.Unmarshal(cp, &checkpoint); err != nil {
		return nil, true, fmt.Errorf("checkpoint unmarshal %s: %w", runKey, err)
	}
	return &checkpoint, true, nil
}

// LoadCurrent fetches the active Checkpoint referenced by current.json.
func (s *Store) LoadCurrent(ctx context.Context) (*model.Checkpoint, bool, error) {
	ptrBytes, exists, err := s.fetchJSON(ctx, model.PointerKey)
	if err != nil || !exists {
		return nil, false, err
	}

	var ptr model.CurrentPointer
	if err := json.Unmarshal(ptrBytes, &ptr); err != nil {
		return nil, true, fmt.Errorf("pointer unmarshal: %w", err)
	}

	return s.Load(ctx, ptr.ActiveRunID)
}

func (s *Store) fetchJSON(ctx context.Context, key string) ([]byte, bool, error) {
	rc, err := s.client.GetObject(ctx, s.bucket, key)
	if err != nil {
		if errors.Is(err, model.ErrObjectNotFound) {
			return nil, false, nil
		}
		return nil, false, fmt.Errorf("get json object %s: %w", key, err)
	}
	defer rc.Close()

	data, err := io.ReadAll(rc)
	if err != nil {
		if errors.Is(err, model.ErrObjectNotFound) {
			return nil, false, nil
		}
		return nil, false, fmt.Errorf("read json object %s: %w", key, err)
	}
	return data, true, nil
}
