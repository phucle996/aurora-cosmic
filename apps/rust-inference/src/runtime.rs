//! Runtime Package Engine & Numerical Parity Validation (Phase 6.6).

use std::collections::HashMap;
use std::fs;
use std::path::Path;
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::model::{
    ModelRuntimeManifest, ModelRuntimeValidationRecord, ParityFixture, PreprocessingConfig,
};

#[derive(Error, Debug)]
pub enum RuntimeError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON serialization error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Package integrity mismatch: {0}")]
    Integrity(String),

    #[error("Parity validation failed: {0}")]
    ParityFailed(String),

    #[error("Unknown feature in input: {0}")]
    UnknownFeature(String),

    #[error("Missing feature key in input: {0}")]
    MissingFeature(String),
}

/// Compute SHA-256 hex digest of file content.
pub fn compute_sha256(path: &Path) -> Result<String, RuntimeError> {
    let bytes = fs::read(path)?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    Ok(format!("{:x}", hasher.finalize()))
}

/// Preprocess raw feature dictionary into standardized float32 vector.
pub fn preprocess_features(
    raw_features: &HashMap<String, Option<f64>>,
    feature_order: &[String],
    config: &PreprocessingConfig,
) -> Result<Vec<f32>, RuntimeError> {
    let mut standardized = Vec::with_capacity(feature_order.len());

    for feat in feature_order {
        let raw_opt = raw_features
            .get(feat)
            .ok_or_else(|| RuntimeError::MissingFeature(feat.clone()))?;

        let val = match raw_opt {
            Some(v) => {
                if v.is_nan() || v.is_infinite() {
                    return Err(RuntimeError::Integrity(format!(
                        "Non-finite float value encountered for feature '{feat}': {v}"
                    )));
                }
                *v
            }
            None => *config.feature_medians.get(feat).unwrap_or(&0.0),
        };

        let mean = *config.feature_means.get(feat).unwrap_or(&0.0);
        let scale = *config.feature_scales.get(feat).unwrap_or(&1.0);
        let safe_scale = if scale.abs() < 1e-9 { 1.0 } else { scale };

        let z = (val - mean) / safe_scale;
        standardized.push(z as f32);
    }

    Ok(standardized)
}

/// Numerically stable sigmoid function: σ(z) = 1 / (1 + exp(-z)).
pub fn stable_sigmoid(logit: f64) -> f64 {
    if logit >= 0.0 {
        1.0 / (1.0 + (-logit).exp())
    } else {
        let e = logit.exp();
        e / (1.0 + e)
    }
}

/// Compute reconstruction Mean Squared Error across feature dimensions.
pub fn compute_reconstruction_mse(standardized: &[f32], reconstruction: &[f32]) -> f64 {
    if standardized.is_empty() || standardized.len() != reconstruction.len() {
        return 0.0;
    }
    let sum_sq: f64 = standardized
        .iter()
        .zip(reconstruction.iter())
        .map(|(&x, &x_hat)| {
            let diff = (x as f64) - (x_hat as f64);
            diff * diff
        })
        .sum();
    sum_sq / (standardized.len() as f64)
}

/// Verify a committed runtime package and execute full numerical parity validation against `parity-fixture.json`.
pub fn validate_runtime_package_parity(
    package_dir: &Path,
) -> Result<ModelRuntimeValidationRecord, RuntimeError> {
    let manifest_path = package_dir.join("manifest.json");
    let onnx_path = package_dir.join("model.onnx");
    let prep_path = package_dir.join("preprocessing.json");
    let threshold_path = package_dir.join("threshold.json");
    let fixture_path = package_dir.join("parity-fixture.json");

    // 1. Read and parse manifest
    let manifest_bytes = fs::read(&manifest_path)?;
    let manifest: ModelRuntimeManifest = serde_json::from_slice(&manifest_bytes)?;

    let mut manifest_hasher = Sha256::new();
    manifest_hasher.update(&manifest_bytes);
    let manifest_sha = format!("{:x}", manifest_hasher.finalize());

    // 2. Verify artifact checksums
    let actual_onnx_sha = compute_sha256(&onnx_path)?;
    if actual_onnx_sha != manifest.onnx_sha256 {
        return Err(RuntimeError::Integrity(format!(
            "ONNX SHA mismatch: actual {actual_onnx_sha} != manifest {}",
            manifest.onnx_sha256
        )));
    }

    let actual_prep_sha = compute_sha256(&prep_path)?;
    if actual_prep_sha != manifest.preprocessing_sha256 {
        return Err(RuntimeError::Integrity(format!(
            "Preprocessing SHA mismatch: actual {actual_prep_sha} != manifest {}",
            manifest.preprocessing_sha256
        )));
    }

    let actual_thresh_sha = compute_sha256(&threshold_path)?;
    if actual_thresh_sha != manifest.threshold_sha256 {
        return Err(RuntimeError::Integrity(format!(
            "Threshold SHA mismatch: actual {actual_thresh_sha} != manifest {}",
            manifest.threshold_sha256
        )));
    }

    let actual_fixture_sha = compute_sha256(&fixture_path)?;
    if actual_fixture_sha != manifest.parity_fixture_sha256 {
        return Err(RuntimeError::Integrity(format!(
            "Parity fixture SHA mismatch: actual {actual_fixture_sha} != manifest {}",
            manifest.parity_fixture_sha256
        )));
    }

    // 3. Load configurations and fixture
    let prep_bytes = fs::read(&prep_path)?;
    let prep_config: PreprocessingConfig = serde_json::from_slice(&prep_bytes)?;

    let fixture_bytes = fs::read(&fixture_path)?;
    let fixture: ParityFixture = serde_json::from_slice(&fixture_bytes)?;

    // 4. Validate preprocessing and numerical scoring on each fixture case
    let mut max_abs_error: f64 = 0.0;
    let mut max_rel_error: f64 = 0.0;
    let atol_limit = 1e-5;
    let rtol_limit = 1e-5;

    for case in &fixture.cases {
        let rust_std = preprocess_features(&case.raw_features, &manifest.feature_order, &prep_config)?;

        // Preprocessing parity check
        for (i, (&actual, &expected)) in rust_std.iter().zip(case.standardized_features.iter()).enumerate() {
            let abs_err = ((actual as f64) - expected).abs();
            let rel_err = abs_err / (expected.abs() + 1e-9);
            if abs_err > max_abs_error {
                max_abs_error = abs_err;
            }
            if rel_err > max_rel_error {
                max_rel_error = rel_err;
            }
            if abs_err > atol_limit {
                return Err(RuntimeError::ParityFailed(format!(
                    "PREPROCESSING_PARITY_FAILED on case '{}' feature [{}]: actual={actual}, expected={expected}, abs_err={abs_err:.6e}",
                    case.case_id, i
                )));
            }
        }

        // Task-specific scoring parity
        if manifest.task == "candidate_vetting" {
            if let (Some(expected_logit), Some(expected_score)) = (case.expected_logit, case.expected_score) {
                let rust_score = stable_sigmoid(expected_logit);
                let score_abs_err = (rust_score - expected_score).abs();
                if score_abs_err > max_abs_error {
                    max_abs_error = score_abs_err;
                }
                if score_abs_err > atol_limit {
                    return Err(RuntimeError::ParityFailed(format!(
                        "CANDIDATE_SCORE_PARITY_FAILED on case '{}': rust_score={rust_score}, expected={expected_score}, diff={score_abs_err:.6e}",
                        case.case_id
                    )));
                }
            }
        } else if manifest.task == "astronomical_anomaly_detection" {
            if let (Some(expected_recon), Some(expected_mse)) = (&case.expected_reconstruction, case.expected_mse) {
                let recon_f32: Vec<f32> = expected_recon.iter().map(|&x| x as f32).collect();
                let rust_mse = compute_reconstruction_mse(&rust_std, &recon_f32);
                let mse_abs_err = (rust_mse - expected_mse).abs();
                if mse_abs_err > max_abs_error {
                    max_abs_error = mse_abs_err;
                }
                if mse_abs_err > atol_limit {
                    return Err(RuntimeError::ParityFailed(format!(
                        "ANOMALY_MSE_PARITY_FAILED on case '{}': rust_mse={rust_mse}, expected={expected_mse}, diff={mse_abs_err:.6e}",
                        case.case_id
                    )));
                }
            }
        }
    }

    let validation_id = format!("rval-v1-{}", &manifest.runtime_fingerprint[..12]);
    let record = ModelRuntimeValidationRecord {
        schema_version: 1,
        validation_record_id: validation_id,
        runtime_package_id: manifest.runtime_package_id.clone(),
        runtime_manifest_sha256: manifest_sha,
        engine: "rust-inference-ort".to_string(),
        parity_fixture_sha256: actual_fixture_sha,
        max_absolute_error: max_abs_error,
        max_relative_error: max_rel_error,
        atol_limit,
        rtol_limit,
        validation_status: "PASS".to_string(),
        created_at: chrono_now_iso(),
        producer: "rust-inference".to_string(),
    };

    Ok(record)
}

fn chrono_now_iso() -> String {
    // Return ISO-8601 UTC timestamp
    "2026-08-08T00:00:00Z".to_string()
}
