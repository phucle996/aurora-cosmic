//! Rust Inference Prediction Contracts & Job Manifest Parsing Tests (Phase 7.1).

use aurora_inference::job::{InferenceJobManifest, InferenceJobRequestedEvent};
use aurora_inference::prediction::{
    compute_anomaly_prediction_id, compute_candidate_prediction_id, compute_model_input_sha256,
};

#[test]
fn test_rust_model_input_sha256() {
    let vec: Vec<f32> = vec![1.0, 2.5, -3.0];
    let sha = compute_model_input_sha256(&vec);
    assert_eq!(sha.len(), 64);

    // Repeated execution yields same hash
    assert_eq!(compute_model_input_sha256(&vec), sha);
}

#[test]
fn test_rust_prediction_id_determinism() {
    let (p1, fp1) = compute_candidate_prediction_id("pkg-123", "gold-456", "prod-789");
    let (p2, fp2) = compute_candidate_prediction_id("pkg-123", "gold-456", "prod-789");
    assert_eq!(p1, p2);
    assert_eq!(fp1, fp2);
    assert!(p1.starts_with("pred-cand-v1-"));

    let (pa, _) = compute_anomaly_prediction_id("pkg-123", "gold-456", "prod-789");
    assert!(pa.starts_with("pred-anom-v1-"));
    assert_ne!(p1, pa);
}

#[test]
fn test_rust_inference_job_manifest_json_roundtrip() {
    let raw_json = r#"{
        "schema_version": 1,
        "job_id": "inference-job-v1-0123456789abcdef",
        "job_fingerprint": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        "task": "candidate_vetting",
        "selection_policy_version": "candidate-inference-selection-v1",
        "gold_snapshot_id": "gold-v1-test",
        "gold_manifest_key": "gold/candidate/gold-v1-test/manifest.json",
        "gold_manifest_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "gold_dataset": "candidate",
        "gold_schema_version": "gold-candidate-v1",
        "gold_artifact_key": "gold/candidate/gold-v1-test/part-001.parquet",
        "gold_artifact_content_sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "gold_artifact_row_count": 100,
        "sector": 10,
        "runtime_package_id": "run-pkg-123",
        "runtime_manifest_key": "models/runtime/candidate/run-pkg-123/manifest.json",
        "runtime_manifest_sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        "runtime_validation_id": "rval-123",
        "model_id": "m-cand-123",
        "model_version": "candidate-tabular-mlp-v1",
        "evaluation_run_id": "eval-123",
        "dataset_view_version": "candidate-ml-view-v1",
        "dataset_view_fingerprint": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
        "feature_names": ["f1", "f2"],
        "expected_prediction_count": 100,
        "created_at": "2026-08-08T00:00:00Z"
    }"#;

    let manifest: InferenceJobManifest = serde_json::from_str(raw_json).expect("Parse error");
    assert_eq!(manifest.schema_version, 1);
    assert_eq!(manifest.task, "candidate_vetting");
    assert_eq!(manifest.expected_prediction_count, 100);
}

#[test]
fn test_rust_nats_request_event_json_parsing() {
    let raw_event = r#"{
        "schema_version": 1,
        "event_id": "evt-123",
        "event_type": "aurora.v1.inference.candidate.requested",
        "occurred_at": "2026-08-08T00:00:00Z",
        "task": "candidate_vetting",
        "job_id": "inference-job-v1-0123456789abcdef",
        "job_manifest_bucket": "aurora-manifests",
        "job_manifest_key": "manifests/inference-jobs/candidate/inference-job-v1-0123456789abcdef.json",
        "job_manifest_sha256": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        "runtime_package_id": "run-pkg-123",
        "gold_snapshot_id": "gold-v1-test",
        "gold_artifact_key": "gold/candidate/gold-v1-test/part-001.parquet",
        "sector": 10,
        "expected_prediction_count": 100,
        "producer": "python-ml-worker"
    }"#;

    let event: InferenceJobRequestedEvent =
        serde_json::from_str(raw_event).expect("Event parse error");
    assert_eq!(event.schema_version, 1);
    assert_eq!(event.event_type, "aurora.v1.inference.candidate.requested");
    assert_eq!(event.expected_prediction_count, 100);
}
