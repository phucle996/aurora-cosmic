package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"testing"

	"go-api/infra/nats"

	natsio "github.com/nats-io/nats.go"
)

func TestChampionInferencePlannerMaterializesAndDispatchesMissingSnapshot(t *testing.T) {
	runtimeRaw := []byte(`{
		"runtime_package_id":"runtime-v1-test", "runtime_fingerprint":"1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
		"task":"candidate_vetting", "source_model_id":"model-v1-test", "model_version":"candidate-tabular-mlp-v1",
		"source_evaluation_run_id":"eval-v1-test", "feature_order":["bls_period","bls_depth"],
		"created_at":"2026-09-03T00:00:00Z"
	}`)
	objects := &memoryModelObjects{objects: map[string][]byte{
		"models/candidate/champion.json": []byte(`{
			"runtime_package_id":"runtime-v1-test", "model_id":"model-v1-test", "task":"candidate_vetting",
			"promoted_at":"2026-09-03T00:01:00Z", "runtime_validation_id":"rval-v1-1234567890ab"
		}`),
		"models/runtime/candidate_vetting/model-v1-test/runtime-v1-test/manifest.json": runtimeRaw,
		"gold/snapshots/gold-v1-new/manifest.json": []byte(`{
			"snapshot_id":"gold-v1-new", "status":"COMMITTED", "gold_schema_version":"gold-candidate-v4",
			"artifacts":[{
				"dataset":"candidate", "sector":2, "object_key":"gold/snapshots/gold-v1-new/data/candidate/sector=0002/part-00000.parquet",
				"row_count":26, "content_sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
				"parquet_sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "size_bytes":2048
			}]
		}`),
	}}
	var payloads [][]byte
	natsClient := &nats.Client{
		PublishMsgFunc: func(_ context.Context, msg *natsio.Msg) (*natsio.PubAck, error) {
			payloads = append(payloads, append([]byte(nil), msg.Data...))
			return &natsio.PubAck{}, nil
		},
	}
	planner := NewInferenceServiceWithResults(objects, objects, natsClient, "aurora")

	dispatched, err := planner.EnsureChampionCoverage(context.Background(), "gold-v1-new")
	if err != nil || dispatched != 1 || len(payloads) != 1 {
		t.Fatalf("missing snapshot was not dispatched: count=%d calls=%d err=%v", dispatched, len(payloads), err)
	}
	manifestObjects, err := objects.ListObjects(context.Background(), "manifests/inference-jobs/candidate/")
	if err != nil || len(manifestObjects) != 1 {
		t.Fatalf("immutable manifest was not materialized: objects=%#v err=%v", manifestObjects, err)
	}
	manifestRaw := objects.objects[manifestObjects[0].Key]
	var manifest inferenceJobManifestDTO
	if err := json.Unmarshal(manifestRaw, &manifest); err != nil {
		t.Fatalf("decode planned manifest: %v", err)
	}
	if manifest.RuntimePackageID != "runtime-v1-test" || manifest.GoldArtifactContentSHA256 != "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" || manifest.ExpectedPredictionCount != 26 {
		t.Fatalf("planned manifest does not bind champion and physical Gold bytes: %#v", manifest)
	}
	digest := sha256.Sum256(manifestRaw)
	var event struct {
		JobID             string `json:"job_id"`
		JobManifestSHA256 string `json:"job_manifest_sha256"`
		JobManifestBucket string `json:"job_manifest_bucket"`
		GoldSnapshotID    string `json:"gold_snapshot_id"`
	}
	if err := json.Unmarshal(payloads[0], &event); err != nil {
		t.Fatalf("decode planned event: %v", err)
	}
	if event.JobID != manifest.JobID || event.JobManifestSHA256 != hex.EncodeToString(digest[:]) || event.JobManifestBucket != "aurora" || event.GoldSnapshotID != "gold-v1-new" {
		t.Fatalf("event does not bind immutable job manifest: %#v", event)
	}

	status, _ := json.Marshal(inferenceJobStatusDTO{
		SchemaVersion: 1, JobID: manifest.JobID, JobFingerprint: manifest.JobFingerprint,
		Task: manifest.Task, Status: "completed", Producer: "rust-inference",
	})
	objects.objects["inference/status/"+manifest.JobID+".json"] = status
	dispatched, err = planner.EnsureChampionCoverage(context.Background(), "gold-v1-new")
	if err != nil || dispatched != 0 || len(payloads) != 1 {
		t.Fatalf("completed inference was dispatched again: count=%d calls=%d err=%v", dispatched, len(payloads), err)
	}
}
