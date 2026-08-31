//! Inference Job Contract & NATS Event Structs (Phase 7.1).

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum JobError {
    #[error("JSON serialization error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Unknown event type: {0}")]
    UnknownEventType(String),

    #[error("Job schema version mismatch: expected {expected}, got {actual}")]
    SchemaMismatch { expected: i64, actual: i64 },
}

/// NATS request event payload conforming to `contracts/events/inference-job-requested.schema.json`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct InferenceJobRequestedEvent {
    pub schema_version: i64,
    pub event_id: String,
    pub event_type: String,
    pub occurred_at: String,
    pub task: String,
    pub job_id: String,
    #[serde(default = "default_manifest_bucket")]
    pub job_manifest_bucket: String,
    pub job_manifest_key: String,
    pub job_manifest_sha256: String,
    pub runtime_package_id: String,
    pub gold_snapshot_id: String,
    pub gold_artifact_key: String,
    pub sector: i64,
    pub expected_prediction_count: i64,
    #[serde(default = "default_producer")]
    pub producer: String,
}

fn default_manifest_bucket() -> String {
    "aurora-manifests".to_string()
}

fn default_producer() -> String {
    "python-ml-worker".to_string()
}

/// Immutable inference job manifest conforming to `inference-job-v1`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct InferenceJobManifest {
    pub schema_version: i64,
    pub job_id: String,
    pub job_fingerprint: String,
    pub task: String,
    pub selection_policy_version: String,
    pub gold_snapshot_id: String,
    pub gold_manifest_key: String,
    pub gold_manifest_sha256: String,
    pub gold_dataset: String,
    pub gold_schema_version: String,
    pub gold_artifact_key: String,
    pub gold_artifact_content_sha256: String,
    #[serde(default)]
    pub gold_artifact_parquet_sha256: Option<String>,
    #[serde(default)]
    pub gold_artifact_size_bytes: Option<i64>,
    pub gold_artifact_row_count: i64,
    pub sector: i64,
    pub runtime_package_id: String,
    pub runtime_manifest_key: String,
    pub runtime_manifest_sha256: String,
    pub runtime_validation_id: String,
    #[serde(default)]
    pub runtime_validation_key: Option<String>,
    #[serde(default)]
    pub runtime_validation_sha256: Option<String>,
    pub model_id: String,
    pub model_version: String,
    pub evaluation_run_id: String,
    pub dataset_view_version: String,
    pub dataset_view_fingerprint: String,
    pub feature_names: Vec<String>,
    pub expected_prediction_count: i64,
    pub created_at: String,
    #[serde(default = "default_producer")]
    pub producer: String,
}

/// Mutable execution state for one immutable inference job. It is deliberately
/// kept separate from the job manifest: the manifest defines the work, while
/// this record makes delivery attempts and terminal outcomes observable.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct InferenceJobStatusRecord {
    pub schema_version: i64,
    pub job_id: String,
    pub job_fingerprint: String,
    pub task: String,
    pub status: String,
    pub attempt: i64,
    pub started_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub output_key: Option<String>,
    #[serde(default)]
    pub output_sha256: Option<String>,
    #[serde(default)]
    pub processed_rows: Option<i64>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default = "default_rust_inference_producer")]
    pub producer: String,
}

fn default_rust_inference_producer() -> String {
    "rust-inference".to_string()
}

/// Compute deterministic SHA-256 job fingerprint.
// The event contract contributes all nine fields to the identity; grouping them
// would make call sites less explicit at the boundary where manifests are built.
#[allow(clippy::too_many_arguments)]
pub fn compute_job_fingerprint(
    task: &str,
    selection_policy_version: &str,
    gold_snapshot_id: &str,
    gold_manifest_sha256: &str,
    gold_artifact_key: &str,
    gold_artifact_content_sha256: &str,
    runtime_package_id: &str,
    runtime_manifest_sha256: &str,
    runtime_validation_id: &str,
) -> (String, String) {
    let canonical = format!(
        "{{\"gold_artifact_content_sha256\":\"{gold_artifact_content_sha256}\",\"gold_artifact_key\":\"{gold_artifact_key}\",\"gold_manifest_sha256\":\"{gold_manifest_sha256}\",\"gold_snapshot_id\":\"{gold_snapshot_id}\",\"runtime_manifest_sha256\":\"{runtime_manifest_sha256}\",\"runtime_package_id\":\"{runtime_package_id}\",\"runtime_validation_id\":\"{runtime_validation_id}\",\"selection_policy_version\":\"{selection_policy_version}\",\"task\":\"{task}\"}}"
    );

    let mut hasher = Sha256::new();
    hasher.update(canonical.as_bytes());
    let fp = format!("{:x}", hasher.finalize());
    let job_id = format!("inference-job-v1-{}", &fp[..16]);
    (job_id, fp)
}
