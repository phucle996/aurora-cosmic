//! Runtime Package Engine & Numerical Parity Validation (Phase 6.6).

use chrono::Utc;
use ndarray::Array2;
use ort::{session::Session, value::TensorRef};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::fs::File;
use std::io::{BufReader, Read};
use std::path::Path;
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

    #[error("Invalid runtime package: {0}")]
    InvalidPackage(String),

    #[error("Invalid model output: {0}")]
    InvalidOutput(String),

    #[error("ONNX Runtime error: {0}")]
    Ort(String),
}

/// Compute SHA-256 hex digest of file content.
pub fn compute_sha256(path: &Path) -> Result<String, RuntimeError> {
    let file = File::open(path)?;
    let mut reader = BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 1024 * 1024];
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
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
            None => *config.feature_medians.get(feat).ok_or_else(|| {
                RuntimeError::InvalidPackage(format!(
                    "missing median for nullable feature '{feat}'"
                ))
            })?,
        };

        let mean = *config.feature_means.get(feat).ok_or_else(|| {
            RuntimeError::InvalidPackage(format!("missing mean for feature '{feat}'"))
        })?;
        let scale = *config.feature_scales.get(feat).ok_or_else(|| {
            RuntimeError::InvalidPackage(format!("missing scale for feature '{feat}'"))
        })?;
        if !mean.is_finite() || !scale.is_finite() || scale.abs() < 1e-9 {
            return Err(RuntimeError::InvalidPackage(format!(
                "invalid preprocessing parameters for feature '{feat}'"
            )));
        }

        let z = (val - mean) / scale;
        let z32 = z as f32;
        if !z.is_finite() || !z32.is_finite() {
            return Err(RuntimeError::Integrity(format!(
                "standardized value for feature '{feat}' is not finite"
            )));
        }
        standardized.push(z32);
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
pub fn compute_reconstruction_mse(
    standardized: &[f32],
    reconstruction: &[f32],
) -> Result<f64, RuntimeError> {
    if standardized.is_empty() || standardized.len() != reconstruction.len() {
        return Err(RuntimeError::InvalidOutput(format!(
            "reconstruction shape mismatch: input={} output={}",
            standardized.len(),
            reconstruction.len()
        )));
    }
    let sum_sq: f64 = standardized
        .iter()
        .zip(reconstruction.iter())
        .map(|(&x, &x_hat)| {
            let diff = (x as f64) - (x_hat as f64);
            diff * diff
        })
        .sum();
    let mse = sum_sq / (standardized.len() as f64);
    if !mse.is_finite() {
        return Err(RuntimeError::InvalidOutput(
            "reconstruction MSE is not finite".to_string(),
        ));
    }
    Ok(mse)
}

fn validate_manifest(manifest: &ModelRuntimeManifest) -> Result<(), RuntimeError> {
    if manifest.schema_version != 1 {
        return Err(RuntimeError::InvalidPackage(format!(
            "unsupported manifest schema version {}",
            manifest.schema_version
        )));
    }
    if !matches!(
        manifest.task.as_str(),
        "candidate_vetting" | "astronomical_anomaly_detection"
    ) {
        return Err(RuntimeError::InvalidPackage(format!(
            "unsupported task '{}'",
            manifest.task
        )));
    }
    if !manifest.runtime_package_id.starts_with("runtime-v1-")
        || manifest.runtime_fingerprint.len() != 64
        || !manifest
            .runtime_fingerprint
            .chars()
            .all(|c| c.is_ascii_hexdigit())
    {
        return Err(RuntimeError::InvalidPackage(
            "invalid runtime identity".to_string(),
        ));
    }
    if manifest.onnx_export_version != "onnx-export-v1"
        || manifest.onnx_opset != 17
        || manifest.onnx_input_name != "features"
        || manifest.feature_order.is_empty()
        || manifest.onnx_size_bytes <= 0
        || manifest.python_parity_status != "PASS"
    {
        return Err(RuntimeError::InvalidPackage(
            "unsupported ONNX manifest fields".to_string(),
        ));
    }
    let mut unique = std::collections::HashSet::new();
    if manifest
        .feature_order
        .iter()
        .any(|f| f.is_empty() || !unique.insert(f))
    {
        return Err(RuntimeError::InvalidPackage(
            "feature_order must be non-empty and unique".to_string(),
        ));
    }
    if !manifest.decision_threshold.is_finite()
        || (manifest.task == "candidate_vetting"
            && !(0.0..=1.0).contains(&manifest.decision_threshold))
        || (manifest.task == "astronomical_anomaly_detection" && manifest.decision_threshold < 0.0)
    {
        return Err(RuntimeError::InvalidPackage(
            "invalid decision threshold".to_string(),
        ));
    }
    Ok(())
}

fn validate_preprocessing(
    feature_order: &[String],
    config: &PreprocessingConfig,
) -> Result<(), RuntimeError> {
    for feature in feature_order {
        let median = config.feature_medians.get(feature).ok_or_else(|| {
            RuntimeError::InvalidPackage(format!("missing preprocessing median for '{feature}'"))
        })?;
        let mean = config.feature_means.get(feature).ok_or_else(|| {
            RuntimeError::InvalidPackage(format!("missing preprocessing mean for '{feature}'"))
        })?;
        let scale = config.feature_scales.get(feature).ok_or_else(|| {
            RuntimeError::InvalidPackage(format!("missing preprocessing scale for '{feature}'"))
        })?;
        if !median.is_finite() || !mean.is_finite() || !scale.is_finite() || scale.abs() < 1e-9 {
            return Err(RuntimeError::InvalidPackage(format!(
                "non-finite or zero preprocessing parameter for '{feature}'"
            )));
        }
    }
    Ok(())
}

fn ort_error(error: impl std::fmt::Display) -> RuntimeError {
    RuntimeError::Ort(error.to_string())
}

/// A validated ONNX Runtime session. The session is intentionally owned by the
/// worker and reused for every batch; creating a session per row is prohibitively
/// expensive and defeats ONNX Runtime graph optimizations.
pub struct OnnxRuntime {
    pub manifest: ModelRuntimeManifest,
    preprocessing: PreprocessingConfig,
    threshold: f64,
    session: Session,
}

impl OnnxRuntime {
    pub fn load(package_dir: &Path, intra_threads: usize) -> Result<Self, RuntimeError> {
        let manifest_bytes = fs::read(package_dir.join("manifest.json"))?;
        let manifest: ModelRuntimeManifest = serde_json::from_slice(&manifest_bytes)?;
        validate_manifest(&manifest)?;

        let model_path = package_dir.join("model.onnx");
        let model_bytes = fs::read(&model_path)?;
        if model_bytes.is_empty() || model_bytes.len() as i64 != manifest.onnx_size_bytes {
            return Err(RuntimeError::Integrity(format!(
                "ONNX size mismatch: actual={} manifest={}",
                model_bytes.len(),
                manifest.onnx_size_bytes
            )));
        }
        if compute_sha256(&model_path)? != manifest.onnx_sha256 {
            return Err(RuntimeError::Integrity("ONNX SHA mismatch".to_string()));
        }

        let prep_path = package_dir.join("preprocessing.json");
        if compute_sha256(&prep_path)? != manifest.preprocessing_sha256 {
            return Err(RuntimeError::Integrity(
                "preprocessing SHA mismatch".to_string(),
            ));
        }
        let preprocessing: PreprocessingConfig = serde_json::from_slice(&fs::read(prep_path)?)?;
        validate_preprocessing(&manifest.feature_order, &preprocessing)?;

        let threshold_path = package_dir.join("threshold.json");
        if compute_sha256(&threshold_path)? != manifest.threshold_sha256 {
            return Err(RuntimeError::Integrity(
                "threshold SHA mismatch".to_string(),
            ));
        }
        let threshold_config: crate::model::ThresholdConfig =
            serde_json::from_slice(&fs::read(threshold_path)?)?;
        if (threshold_config.decision_threshold - manifest.decision_threshold).abs() > 1e-12 {
            return Err(RuntimeError::Integrity(
                "threshold does not match manifest".to_string(),
            ));
        }

        // The environment is process-global. `commit` returns false when a
        // previous worker already initialized it, which is safe and expected.
        ort::init().with_name("aurora-inference").commit();
        let threads = intra_threads.max(1);
        let mut builder = Session::builder().map_err(ort_error)?;
        builder = builder.with_intra_threads(threads).map_err(ort_error)?;
        let session = builder
            .commit_from_memory(&model_bytes)
            .map_err(ort_error)?;
        validate_session_shape(&manifest, &session)?;

        Ok(Self {
            manifest,
            preprocessing,
            threshold: threshold_config.decision_threshold,
            session,
        })
    }

    pub fn threshold(&self) -> f64 {
        self.threshold
    }

    pub fn standardize(
        &self,
        raw_features: &HashMap<String, Option<f64>>,
    ) -> Result<Vec<f32>, RuntimeError> {
        preprocess_features(
            raw_features,
            &self.manifest.feature_order,
            &self.preprocessing,
        )
    }

    /// Execute the actual ONNX graph and return the first output tensor.
    pub fn infer_standardized(&mut self, standardized: &[f32]) -> Result<Vec<f32>, RuntimeError> {
        if standardized.len() != self.manifest.feature_order.len() {
            return Err(RuntimeError::InvalidOutput(format!(
                "input width {} != feature width {}",
                standardized.len(),
                self.manifest.feature_order.len()
            )));
        }
        if standardized.iter().any(|v| !v.is_finite()) {
            return Err(RuntimeError::InvalidOutput(
                "input tensor contains non-finite values".to_string(),
            ));
        }
        let input = Array2::from_shape_vec((1, standardized.len()), standardized.to_vec())
            .map_err(ort_error)?;
        let outputs = self
            .session
            .run(ort::inputs![
                TensorRef::from_array_view(&input).map_err(ort_error)?
            ])
            .map_err(ort_error)?;
        let output = outputs
            .get(&self.manifest.onnx_output_name)
            .ok_or_else(|| {
                RuntimeError::InvalidOutput("declared ONNX output is absent".to_string())
            })?;
        let (shape, values) = output.try_extract_tensor::<f32>().map_err(ort_error)?;
        if values.is_empty() || values.iter().any(|v| !v.is_finite()) {
            return Err(RuntimeError::InvalidOutput(
                "ONNX output is empty or non-finite".to_string(),
            ));
        }
        let expected_width = if self.manifest.task == "candidate_vetting" {
            1
        } else {
            self.manifest.feature_order.len()
        };
        if values.len() != expected_width {
            return Err(RuntimeError::InvalidOutput(format!(
                "ONNX output shape {:?} has {} values; expected {}",
                shape,
                values.len(),
                expected_width
            )));
        }
        Ok(values.to_vec())
    }
}

fn validate_session_shape(
    manifest: &ModelRuntimeManifest,
    session: &Session,
) -> Result<(), RuntimeError> {
    if session.inputs().len() != 1 || session.outputs().len() != 1 {
        return Err(RuntimeError::InvalidPackage(format!(
            "expected one ONNX input/output, got {}/{}",
            session.inputs().len(),
            session.outputs().len()
        )));
    }
    let input = &session.inputs()[0];
    if input.name() != manifest.onnx_input_name {
        return Err(RuntimeError::InvalidPackage(format!(
            "ONNX input name '{}' != manifest '{}'",
            input.name(),
            manifest.onnx_input_name
        )));
    }
    let output = &session.outputs()[0];
    if output.name() != manifest.onnx_output_name {
        return Err(RuntimeError::InvalidPackage(format!(
            "ONNX output name '{}' != manifest '{}'",
            output.name(),
            manifest.onnx_output_name
        )));
    }
    Ok(())
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
    let threshold: crate::model::ThresholdConfig =
        serde_json::from_slice(&fs::read(&threshold_path)?)?;
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
    let mut onnx_runtime = OnnxRuntime::load(package_dir, 1)?;

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
            if abs_err > atol_limit {
                return Err(RuntimeError::ParityFailed(format!(
                    "PREPROCESSING_PARITY_FAILED on case '{}' feature [{}]: actual={actual}, expected={expected}, abs_err={abs_err:.6e}",
                    case.case_id, i
                )));
            }
        }

        // Task-specific scoring parity
        if manifest.task == "candidate_vetting" {
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
            if logit_abs_err > atol_limit {
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
            if score_abs_err > atol_limit {
                return Err(RuntimeError::ParityFailed(format!(
                    "CANDIDATE_SCORE_PARITY_FAILED on case '{}': rust_score={rust_score}, expected={expected_score}, diff={score_abs_err:.6e}",
                    case.case_id
                )));
            }
        } else if manifest.task == "astronomical_anomaly_detection" {
            let expected_recon = case.expected_reconstruction.as_ref().ok_or_else(|| {
                RuntimeError::ParityFailed(format!(
                    "anomaly fixture case '{}' is missing expected reconstruction",
                    case.case_id
                ))
            })?;
            let expected_mse = case.expected_mse.ok_or_else(|| {
                RuntimeError::ParityFailed(format!(
                    "anomaly fixture case '{}' is missing expected MSE",
                    case.case_id
                ))
            })?;
            let expected_recon_f32: Vec<f32> = expected_recon.iter().map(|&x| x as f32).collect();
            if actual_output.len() != expected_recon_f32.len() {
                return Err(RuntimeError::ParityFailed(format!(
                    "ANOMALY_MODEL_PARITY_FAILED on case '{}': output width {} != expected {}",
                    case.case_id,
                    actual_output.len(),
                    expected_recon_f32.len()
                )));
            }
            let output_max_abs = actual_output
                .iter()
                .zip(expected_recon_f32.iter())
                .map(|(actual, expected)| (*actual as f64 - *expected as f64).abs())
                .fold(0.0_f64, f64::max);
            max_abs_error = max_abs_error.max(output_max_abs);
            if output_max_abs > atol_limit {
                return Err(RuntimeError::ParityFailed(format!(
                    "ANOMALY_MODEL_PARITY_FAILED on case '{}': max reconstruction diff={output_max_abs:.6e}",
                    case.case_id
                )));
            }
            let rust_mse = compute_reconstruction_mse(&rust_std, &actual_output)?;
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
