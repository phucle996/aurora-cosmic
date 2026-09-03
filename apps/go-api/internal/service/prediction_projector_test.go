package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"testing"

	"go-api/internal/domain/entity"
	"go-api/internal/domain/repo"
)

type projectionObjects struct {
	values map[string][]byte
}

func (o *projectionObjects) Ping(context.Context) error { return nil }
func (o *projectionObjects) ListObjects(_ context.Context, prefix string) ([]repo.ObjectInfo, error) {
	items := make([]repo.ObjectInfo, 0)
	for key := range o.values {
		if len(key) >= len(prefix) && key[:len(prefix)] == prefix {
			items = append(items, repo.ObjectInfo{Key: key})
		}
	}
	return items, nil
}
func (o *projectionObjects) GetObject(_ context.Context, key string) ([]byte, error) {
	value, found := o.values[key]
	if !found {
		return nil, repo.ErrObjectNotFound
	}
	return value, nil
}
func (o *projectionObjects) PutObject(_ context.Context, key string, value []byte, _ string) error {
	o.values[key] = value
	return nil
}
func (o *projectionObjects) DeleteObject(_ context.Context, key string) error {
	delete(o.values, key)
	return nil
}

type projectionRows struct {
	existing   map[string]struct{}
	candidates []entity.CandidatePredictionProjection
	anomalies  []entity.AnomalyPredictionProjection
}

func (r *projectionRows) ExistingPredictionIDs(_ context.Context, _ string, ids []string) (map[string]struct{}, error) {
	found := make(map[string]struct{})
	for _, id := range ids {
		if _, exists := r.existing[id]; exists {
			found[id] = struct{}{}
		}
	}
	return found, nil
}
func (r *projectionRows) InsertCandidatePredictions(_ context.Context, rows []entity.CandidatePredictionProjection) error {
	r.candidates = append(r.candidates, rows...)
	for _, row := range rows {
		r.existing[row.PredictionID] = struct{}{}
	}
	return nil
}
func (r *projectionRows) InsertAnomalyPredictions(_ context.Context, rows []entity.AnomalyPredictionProjection) error {
	r.anomalies = append(r.anomalies, rows...)
	for _, row := range rows {
		r.existing[row.PredictionID] = struct{}{}
	}
	return nil
}

func candidateProjectionFixture(t *testing.T) (*PredictionProjectorService, *projectionRows, []byte) {
	t.Helper()
	const (
		jobID      = "inference-job-v1-test"
		snapshotID = "gold-v1-test"
		runtimeID  = "runtime-v1-test"
		sourceID   = "mast:TESS/product/test-lc.fits"
		outputKey  = "predictions/candidate_vetting/gold-v1-test/inference-job-v1-test/part-00000.jsonl"
	)
	predictionID := deterministicPredictionID("pred-cand-v1", runtimeID, snapshotID, sourceID)
	record := map[string]any{
		"schema_version": 1, "prediction_id": predictionID,
		"task": candidateTask, "job_id": jobID, "gold_snapshot_id": snapshotID,
		"source_product_id": sourceID, "tic_id": 42, "sector": 2,
		"runtime_package_id": runtimeID, "runtime_validation_id": "validation-v1",
		"registered_model_id": "model-v1", "raw_logit": 1.5,
		"candidate_score": 0.817574, "decision_threshold": 0.6,
		"above_threshold": true, "predicted_at": "2026-09-03T01:02:03Z",
		"producer": "rust-inference",
	}
	line, err := json.Marshal(record)
	if err != nil {
		t.Fatal(err)
	}
	output := append(line, '\n')
	manifest, err := json.Marshal(map[string]any{
		"schema_version": 1, "job_id": jobID, "task": candidateTask,
		"model_version": "candidate-tabular-mlp-v1", "gold_snapshot_id": snapshotID,
		"runtime_package_id": runtimeID,
	})
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(output)
	event, err := json.Marshal(map[string]any{
		"schema_version": 1, "event_id": "inference-completed-v1-test",
		"event_type": "aurora.v1.inference.candidate.completed", "occurred_at": "2026-09-03T01:02:04Z",
		"task": candidateTask, "job_id": jobID, "gold_snapshot_id": snapshotID,
		"runtime_package_id": runtimeID, "output_bucket": "aurora", "output_key": outputKey,
		"output_sha256": hex.EncodeToString(digest[:]), "processed_rows": 1,
		"producer": "rust-inference",
	})
	if err != nil {
		t.Fatal(err)
	}
	rows := &projectionRows{existing: make(map[string]struct{})}
	return &PredictionProjectorService{
		objects: &projectionObjects{values: map[string][]byte{
			outputKey: output,
			"manifests/inference-jobs/candidate/" + jobID + ".json": manifest,
		}},
		predictions: rows, expectedBucket: "aurora",
	}, rows, event
}

func TestPredictionProjectorValidatesAndProjectsCandidateOnce(t *testing.T) {
	projector, rows, event := candidateProjectionFixture(t)

	result, err := projector.ProjectCompletion(context.Background(), event)
	if err != nil {
		t.Fatal(err)
	}
	if result.InsertedRows != 1 || result.ExpectedRows != 1 || len(rows.candidates) != 1 {
		t.Fatalf("unexpected first projection: result=%+v rows=%d", result, len(rows.candidates))
	}
	if rows.candidates[0].ModelVersion != "candidate-tabular-mlp-v1" || rows.candidates[0].PredictedAt != "2026-09-03 01:02:03" {
		t.Fatalf("projection lost runtime evidence: %+v", rows.candidates[0])
	}

	result, err = projector.ProjectCompletion(context.Background(), event)
	if err != nil {
		t.Fatal(err)
	}
	if result.InsertedRows != 0 || len(rows.candidates) != 1 {
		t.Fatalf("replayed completion was not idempotent: result=%+v rows=%d", result, len(rows.candidates))
	}
}

func TestPredictionProjectorRejectsChecksumMismatch(t *testing.T) {
	projector, rows, event := candidateProjectionFixture(t)
	var payload map[string]any
	if err := json.Unmarshal(event, &payload); err != nil {
		t.Fatal(err)
	}
	payload["output_sha256"] = string(make([]byte, 64))
	invalid, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := projector.ProjectCompletion(context.Background(), invalid); err == nil {
		t.Fatal("expected invalid SHA-256 to be rejected")
	}
	if len(rows.candidates) != 0 {
		t.Fatal("invalid output reached ClickHouse projection")
	}
}
