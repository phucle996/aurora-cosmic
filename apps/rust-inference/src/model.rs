//! Model Runtime and Validation Contract Structures (Phase 6.6).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Immutable runtime package manifest conforming to `model-runtime-v1`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ModelRuntimeManifest {
    pub schema_version: i64,
    pub runtime_package_id: String,
    pub runtime_fingerprint: String,
    pub task: String,
    pub source_model_id: String,
    pub source_model_manifest_sha256: String,
    pub source_evaluation_run_id: String,
    pub source_evaluation_manifest_sha256: String,
    pub model_version: String,
    pub preprocessing_version: String,
    pub preprocessing_sha256: String,
    pub threshold_policy_version: String,
    pub threshold_sha256: String,
    pub decision_threshold: f64,
    pub score_definition_version: String,
    pub feature_order: Vec<String>,
    pub onnx_export_version: String,
    pub onnx_opset: i64,
    pub onnx_input_name: String,
    pub onnx_input_shape: Vec<Option<i64>>,
    pub onnx_output_name: String,
    pub onnx_output_shape: Vec<Option<i64>>,
    pub onnx_sha256: String,
    pub onnx_size_bytes: i64,
    pub parity_fixture_version: String,
    pub parity_fixture_sha256: String,
    pub python_parity_policy_version: String,
    pub python_parity_status: String,
    pub created_at: String,
    #[serde(default = "default_producer")]
    pub producer: String,
}

fn default_producer() -> String {
    "python-ml-worker".to_string()
}

/// Preprocessing parameters loaded from `preprocessing.json`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub struct PreprocessingConfig {
    #[serde(default)]
    pub preprocessing_version: String,
    #[serde(default)]
    pub split_id: String,
    #[serde(default)]
    pub feature_medians: HashMap<String, f64>,
    #[serde(default)]
    pub feature_means: HashMap<String, f64>,
    #[serde(default)]
    pub feature_scales: HashMap<String, f64>,
}

/// Threshold configuration loaded from `threshold.json`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub struct ThresholdConfig {
    pub decision_threshold: f64,
}

/// Parity fixture test case loaded from `parity-fixture.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ParityCase {
    pub case_id: String,
    pub raw_features: HashMap<String, Option<f64>>,
    pub standardized_features: Vec<f64>,
    pub expected_logit: Option<f64>,
    pub expected_score: Option<f64>,
    pub expected_reconstruction: Option<Vec<f64>>,
    pub expected_mse: Option<f64>,
    pub expected_above_threshold: bool,
}

/// Parity fixture specification loaded from `parity-fixture.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ParityFixture {
    pub schema_version: i64,
    pub parity_fixture_version: String,
    pub task: String,
    pub feature_order: Vec<String>,
    pub decision_threshold: f64,
    pub cases: Vec<ParityCase>,
}

/// Immutable validation record conforming to `model-runtime-validation-v1`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelRuntimeValidationRecord {
    pub schema_version: i64,
    pub validation_record_id: String,
    pub runtime_package_id: String,
    pub runtime_manifest_sha256: String,
    pub engine: String,
    pub parity_fixture_sha256: String,
    pub max_absolute_error: f64,
    pub max_relative_error: f64,
    pub atol_limit: f64,
    pub rtol_limit: f64,
    pub validation_status: String,
    pub created_at: String,
    pub producer: String,
}
