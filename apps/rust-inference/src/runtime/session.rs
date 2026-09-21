use std::collections::HashMap;
use std::fs;
use std::path::Path;

use ndarray::Array2;
use ort::{ep, session::Session, value::TensorRef};

use crate::domain::model::{ModelRuntimeManifest, PreprocessingConfig, ThresholdConfig};
use super::error::RuntimeError;
use super::math::compute_sha256;
use super::preprocessing::{preprocess_features, validate_preprocessing};

fn ort_error(error: impl std::fmt::Display) -> RuntimeError {
    RuntimeError::Ort(error.to_string())
}

pub fn validate_manifest(manifest: &ModelRuntimeManifest) -> Result<(), RuntimeError> {
    if manifest.schema_version != 1 {
        return Err(RuntimeError::InvalidPackage(format!(
            "unsupported manifest schema version {}",
            manifest.schema_version
        )));
    }
    if manifest.task != "candidate_vetting" {
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
        || !(0.0..=1.0).contains(&manifest.decision_threshold)
    {
        return Err(RuntimeError::InvalidPackage(
            "invalid decision threshold".to_string(),
        ));
    }
    Ok(())
}

fn build_cpu_session(model_bytes: &[u8], threads: usize) -> Result<Session, RuntimeError> {
    let mut builder = Session::builder().map_err(ort_error)?;
    builder = builder.with_intra_threads(threads).map_err(ort_error)?;
    builder.commit_from_memory(model_bytes).map_err(ort_error)
}

fn build_cuda_session(model_bytes: &[u8], threads: usize) -> Result<Session, RuntimeError> {
    let mut builder = Session::builder().map_err(ort_error)?;
    builder = builder.with_intra_threads(threads).map_err(ort_error)?;
    builder = builder
        .with_execution_providers([ep::CUDA::default()
            .with_device_id(0)
            .with_conv_algorithm_search(ep::cuda::ConvAlgorithmSearch::Heuristic)
            .build()
            .error_on_failure()])
        .map_err(ort_error)?;
    builder.commit_from_memory(model_bytes).map_err(ort_error)
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
        Self::load_with_device(package_dir, intra_threads, "auto")
    }

    pub fn load_with_device(
        package_dir: &Path,
        intra_threads: usize,
        device: &str,
    ) -> Result<Self, RuntimeError> {
        if !matches!(device, "auto" | "cuda" | "cpu") {
            return Err(RuntimeError::InvalidPackage(format!(
                "unsupported inference device '{device}'"
            )));
        }
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
        let threshold_config: ThresholdConfig = serde_json::from_slice(&fs::read(threshold_path)?)?;
        if (threshold_config.decision_threshold - manifest.decision_threshold).abs() > 1e-12 {
            return Err(RuntimeError::Integrity(
                "threshold does not match manifest".to_string(),
            ));
        }

        // The environment is process-global. `commit` returns false when a
        // previous worker already initialized it, which is safe and expected.
        ort::init().with_name("aurora-inference").commit();
        let threads = intra_threads.max(1);
        let session = match device {
            "cuda" => build_cuda_session(&model_bytes, threads)?,
            "cpu" => build_cpu_session(&model_bytes, threads)?,
            "auto" => match build_cuda_session(&model_bytes, threads) {
                Ok(session) => session,
                Err(error) => {
                    tracing::warn!(
                        error = %error,
                        "CUDA execution provider unavailable; using CPU execution provider"
                    );
                    build_cpu_session(&model_bytes, threads)?
                }
            },
            _ => unreachable!("device was validated above"),
        };
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

    pub fn preprocessing(&self) -> &PreprocessingConfig {
        &self.preprocessing
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

    /// Execute the actual ONNX graph and return the output tensor.
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
        let expected_width = 1;
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
