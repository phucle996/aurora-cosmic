//! Per-prediction audit evidence for anomaly review.
//!
//! This is deliberately a sidecar contract: the prediction contract remains
//! compact, while reviewers can inspect the exact Gold value, preprocessing
//! result, reconstruction and contribution used by the autoencoder.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AnomalyExplanation {
    pub schema_version: i64,
    pub explanation_version: String,
    pub prediction_id: String,
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
    pub model_version: String,
    pub preprocessing_version: String,
    pub split_id: String,
    pub feature_order: Vec<String>,
    pub model_input_sha256: String,
    pub reconstruction_mse: f64,
    pub decision_threshold: f64,
    pub above_threshold: bool,
    pub features: Vec<AnomalyExplanationFeature>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AnomalyExplanationFeature {
    pub name: String,
    pub gold_value: Option<f64>,
    pub model_value: f64,
    pub imputed: bool,
    pub mean: f64,
    pub scale: f64,
    pub standardized_input: f64,
    pub reconstruction: f64,
    pub residual: f64,
    pub squared_residual: f64,
    pub contribution: f64,
}
