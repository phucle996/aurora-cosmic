//! Prediction Record Data Contracts & Model-Input Hashing (Phase 7.1).

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Compute SHA-256 hash over explicit little-endian float32 tensor bytes.
pub fn compute_model_input_sha256(standardized: &[f32]) -> String {
    let mut hasher = Sha256::new();
    for &val in standardized {
        hasher.update(&val.to_le_bytes());
    }
    format!("{:x}", hasher.finalize())
}

/// Compute deterministic candidate prediction ID.
pub fn compute_candidate_prediction_id(
    runtime_package_id: &str,
    gold_snapshot_id: &str,
    source_product_id: &str,
) -> (String, String) {
    let canonical = format!("pred-cand-v1:{runtime_package_id}:{gold_snapshot_id}:{source_product_id}");
    let mut hasher = Sha256::new();
    hasher.update(canonical.as_bytes());
    let fp = format!("{:x}", hasher.finalize());
    let id = format!("pred-cand-v1-{}", &fp[..16]);
    (id, fp)
}

/// Compute deterministic anomaly prediction ID.
pub fn compute_anomaly_prediction_id(
    runtime_package_id: &str,
    gold_snapshot_id: &str,
    source_product_id: &str,
) -> (String, String) {
    let canonical = format!("pred-anom-v1:{runtime_package_id}:{gold_snapshot_id}:{source_product_id}");
    let mut hasher = Sha256::new();
    hasher.update(canonical.as_bytes());
    let fp = format!("{:x}", hasher.finalize());
    let id = format!("pred-anom-v1-{}", &fp[..16]);
    (id, fp)
}

/// Candidate vetting prediction record conforming to `prediction-candidate-v1`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CandidatePredictionRecord {
    pub schema_version: i64,
    pub prediction_id: String,
    pub prediction_fingerprint: String,
    pub task: String,
    pub job_id: String,
    pub gold_snapshot_id: String,
    pub gold_artifact_key: String,
    pub source_product_id: String,
    pub tic_id: i64,
    #[serde(default)]
    pub sample_id: Option<String>,
    pub sector: i64,
    pub runtime_package_id: String,
    pub runtime_validation_id: String,
    pub registered_model_id: String,
    pub evaluation_run_id: String,
    pub dataset_view_version: String,
    pub model_input_sha256: String,
    pub raw_logit: f64,
    pub candidate_score: f64,
    #[serde(default = "default_candidate_score_definition")]
    pub score_definition_version: String,
    pub decision_threshold: f64,
    pub above_threshold: bool,
    pub predicted_at: String,
    #[serde(default = "default_rust_producer")]
    pub producer: String,
}

fn default_candidate_score_definition() -> String {
    "candidate-sigmoid-score-v1".to_string()
}

fn default_anomaly_score_definition() -> String {
    "reconstruction-mse-v1".to_string()
}

fn default_rust_producer() -> String {
    "rust-inference".to_string()
}

/// Anomaly prediction record conforming to `prediction-anomaly-v1`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AnomalyPredictionRecord {
    pub schema_version: i64,
    pub prediction_id: String,
    pub prediction_fingerprint: String,
    pub task: String,
    pub job_id: String,
    pub gold_snapshot_id: String,
    pub gold_artifact_key: String,
    pub source_product_id: String,
    pub tic_id: i64,
    #[serde(default)]
    pub sample_id: Option<String>,
    pub sector: i64,
    pub runtime_package_id: String,
    pub runtime_validation_id: String,
    pub registered_model_id: String,
    pub evaluation_run_id: String,
    pub dataset_view_version: String,
    pub model_input_sha256: String,
    pub reconstruction_mse: f64,
    #[serde(default = "default_anomaly_score_definition")]
    pub score_definition_version: String,
    pub decision_threshold: f64,
    pub above_threshold: bool,
    pub predicted_at: String,
    #[serde(default = "default_rust_producer")]
    pub producer: String,
}
