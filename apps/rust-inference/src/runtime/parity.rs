use std::fs;
use std::path::Path;

use chrono::Utc;
use sha2::{Digest, Sha256};

use crate::domain::model::{
    ModelRuntimeManifest, ModelRuntimeValidationRecord, ParityFixture, PreprocessingConfig,
    ThresholdConfig,
};
use super::error::RuntimeError;
use super::math::{compute_sha256, stable_sigmoid};
use super::preprocessing::{preprocess_features, validate_preprocessing};
use super::session::{validate_manifest, OnnxRuntime};

fn parity_within_tolerance(actual: f64, expected: f64, atol: f64, rtol: f64) -> bool {
    (actual - expected).abs() <= atol + rtol * expected.abs()
}

/// Verify a committed runtime package and execute full numerical parity validation against `parity-fixture.json`.
pub fn validate_runtime_package_parity(
    package_dir: &Path,
) -> Result<ModelRuntimeValidationRecord, RuntimeError> {
    validate_runtime_package_parity_with_device(package_dir, "auto")
}

pub fn validate_runtime_package_parity_with_device(
    package_dir: &Path,
    device: &str,
) -> Result<ModelRuntimeValidationRecord, RuntimeError> {
    let manifest_path = package_dir.join("manifest.json");
    let onnx_path = package_dir.join("model.onnx");
    let prep_path = package_dir.join("preprocessing.json");
    let threshold_path = package_dir.join("threshold.json");
    let fixture_path = package_dir.join("parity-fixture.json");

    // 1. Read and parse manifest
    let manifest_bytes = fs::read(&manifest_path)?;
    let manifest: ModelRuntimeManifest = serde_json::from_slice(&manifest_bytes)?;
    validate_manifest(&manifest)?;

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
    let threshold: ThresholdConfig = serde_json::from_slice(&fs::read(&threshold_path)?)?;
    if !threshold.decision_threshold.is_finite()
        || (threshold.decision_threshold - manifest.decision_threshold).abs() > 1e-12
    {
        return Err(RuntimeError::Integrity(
            "threshold.json does not match manifest decision_threshold".to_string(),
        ));
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
    validate_preprocessing(&manifest.feature_order, &prep_config)?;

    let fixture_bytes = fs::read(&fixture_path)?;
    let fixture: ParityFixture = serde_json::from_slice(&fixture_bytes)?;
    if fixture.schema_version != 1
        || fixture.parity_fixture_version != manifest.parity_fixture_version
        || fixture.task != manifest.task
        || fixture.feature_order != manifest.feature_order
        || fixture.cases.is_empty()
    {
        return Err(RuntimeError::InvalidPackage(
            "parity fixture does not match runtime manifest".to_string(),
        ));
    }
    let mut onnx_runtime = OnnxRuntime::load_with_device(package_dir, 1, device)?;

    // 4. Validate preprocessing and numerical scoring on each fixture case
    let mut max_abs_error: f64 = 0.0;
    let mut max_rel_error: f64 = 0.0;
    let atol_limit = 1e-5;
    let rtol_limit = 1e-5;

    for case in &fixture.cases {
        if case.raw_features.len() < manifest.feature_order.len()
            || case.standardized_features.len() != manifest.feature_order.len()
        {
            return Err(RuntimeError::ParityFailed(format!(
                "fixture case '{}' has an invalid feature vector",
                case.case_id
            )));
        }
        let rust_std =
            preprocess_features(&case.raw_features, &manifest.feature_order, &prep_config)?;
        let actual_output = onnx_runtime.infer_standardized(&rust_std)?;

        // Preprocessing parity check
        for (i, (&actual, &expected)) in rust_std
            .iter()
            .zip(case.standardized_features.iter())
            .enumerate()
        {
            let abs_err = ((actual as f64) - expected).abs();
            let rel_err = abs_err / (expected.abs() + 1e-9);
            if abs_err > max_abs_error {
                max_abs_error = abs_err;
            }
            if rel_err > max_rel_error {
                max_rel_error = rel_err;
            }
            if !parity_within_tolerance(actual as f64, expected, atol_limit, rtol_limit) {
                return Err(RuntimeError::ParityFailed(format!(
                    "PREPROCESSING_PARITY_FAILED on case '{}' feature [{}]: actual={actual}, expected={expected}, abs_err={abs_err:.6e}",
                    case.case_id, i
                )));
            }
        }

        // Candidate vetting scoring parity
        let expected_logit = case.expected_logit.ok_or_else(|| {
            RuntimeError::ParityFailed(format!(
                "candidate fixture case '{}' is missing expected logit",
                case.case_id
            ))
        })?;
        let expected_score = case.expected_score.ok_or_else(|| {
            RuntimeError::ParityFailed(format!(
                "candidate fixture case '{}' is missing expected score",
                case.case_id
            ))
        })?;
        let logit_abs_err = (actual_output[0] as f64 - expected_logit).abs();
        max_abs_error = max_abs_error.max(logit_abs_err);
        max_rel_error = max_rel_error.max(logit_abs_err / (expected_logit.abs() + 1e-9));
        if !parity_within_tolerance(
            actual_output[0] as f64,
            expected_logit,
            atol_limit,
            rtol_limit,
        ) {
            return Err(RuntimeError::ParityFailed(format!(
                "CANDIDATE_MODEL_PARITY_FAILED on case '{}': actual_logit={}, expected_logit={}, diff={logit_abs_err:.6e}",
                case.case_id, actual_output[0], expected_logit
            )));
        }
        let rust_score = stable_sigmoid(actual_output[0] as f64);
        let score_abs_err = (rust_score - expected_score).abs();
        if score_abs_err > max_abs_error {
            max_abs_error = score_abs_err;
        }
        if !parity_within_tolerance(rust_score, expected_score, atol_limit, rtol_limit) {
            return Err(RuntimeError::ParityFailed(format!(
                "CANDIDATE_SCORE_PARITY_FAILED on case '{}': rust_score={rust_score}, expected={expected_score}, diff={score_abs_err:.6e}",
                case.case_id
            )));
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
        created_at: Utc::now().to_rfc3339(),
        producer: "rust-inference".to_string(),
    };

    Ok(record)
}
