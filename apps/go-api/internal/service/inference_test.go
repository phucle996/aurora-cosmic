package service

import (
	"context"
	"testing"
)

func TestListInferenceJobsIncludesDurableRuntimeDiagnostics(t *testing.T) {
	objects := &memoryModelObjects{objects: map[string][]byte{
		"manifests/inference-jobs/candidate/inference-job-v1-test.json": []byte(`{
            "schema_version":1,
            "job_id":"inference-job-v1-test",
            "job_fingerprint":"fingerprint-test",
            "task":"candidate_vetting",
            "gold_snapshot_id":"gold-v1-test",
            "gold_artifact_key":"gold/data/test.parquet",
            "gold_artifact_row_count":12,
            "sector":2,
            "runtime_package_id":"runtime-v1-test",
            "model_id":"model-v1-test",
            "model_version":"candidate-tabular-mlp-v1",
            "expected_prediction_count":12,
            "created_at":"2026-09-02T00:00:00Z"
        }`),
		"inference/status/inference-job-v1-test.json": []byte(`{
            "schema_version":1,
            "job_id":"inference-job-v1-test",
            "job_fingerprint":"fingerprint-test",
            "task":"candidate_vetting",
            "status":"failed",
            "attempt":5,
            "started_at":"2026-09-02T00:01:00Z",
            "updated_at":"2026-09-02T00:02:00Z",
            "processed_rows":7,
            "error":"RUNTIME_PACKAGE_INTEGRITY_FAILED",
            "producer":"rust-inference"
        }`),
	}}

	jobs, err := NewInferenceService(objects, nil).ListJobs(context.Background(), "", "")
	if err != nil {
		t.Fatalf("list inference jobs: %v", err)
	}
	if len(jobs) != 1 {
		t.Fatalf("expected one inference job, got %#v", jobs)
	}
	job := jobs[0]
	if job.Status != "failed" || job.Attempt != 5 || job.ProcessedRows != 7 || job.Error != "RUNTIME_PACKAGE_INTEGRITY_FAILED" {
		t.Fatalf("runtime diagnostics were not preserved: %#v", job)
	}
}
