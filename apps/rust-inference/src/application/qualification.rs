use std::collections::HashSet;
use std::path::Path;
use std::sync::OnceLock;

use anyhow::{Context, Result};
use tokio::sync::Mutex;

use crate::adapters::storage::ObjectStore;
use crate::config::Config;
use crate::domain::job::InferenceJobManifest;
use crate::domain::model::ModelRuntimeValidationRecord;
use crate::runtime::{compute_sha256, validate_runtime_package_parity_with_device};

static VALIDATED_RUNTIME_PACKAGES: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

pub async fn qualify_runtime_package(
    store: &ObjectStore,
    config: &Config,
    job: &InferenceJobManifest,
    package_dir: &Path,
) -> Result<()> {
    let manifest_sha = compute_sha256(&package_dir.join("manifest.json"))
        .map_err(anyhow::Error::new)?;
    if manifest_sha != job.runtime_manifest_sha256 {
        anyhow::bail!("downloaded runtime manifest SHA does not match inference job")
    }
    let validation_key = format!(
        "models/runtime-validations/{}.json",
        job.runtime_validation_id
    );
    if let Some(expected_key) = &job.runtime_validation_key {
        if expected_key != &validation_key {
            anyhow::bail!("runtime validation key does not match job manifest")
        }
    }
    let cache_key = format!("{}:{}", job.runtime_package_id, job.runtime_manifest_sha256);
    let cache = VALIDATED_RUNTIME_PACKAGES.get_or_init(|| Mutex::new(HashSet::new()));
    if cache.lock().await.contains(&cache_key) {
        return verify_persisted_runtime_validation(store, config, job, &validation_key).await;
    }

    let validation = validate_runtime_package_parity_with_device(package_dir, &config.ml.device)
        .map_err(anyhow::Error::new)?;
    if validation.validation_status != "PASS"
        || validation.runtime_manifest_sha256 != job.runtime_manifest_sha256
        || validation.runtime_package_id != job.runtime_package_id
        || validation.validation_record_id != job.runtime_validation_id
    {
        anyhow::bail!("runtime package parity validation does not match job manifest")
    }
    match store.get(&config.minio.bucket, &validation_key).await {
        Ok(existing) => {
            let prior = serde_json::from_slice::<ModelRuntimeValidationRecord>(&existing)
                .context("decode existing runtime validation record")?;
            validate_runtime_validation_record(&prior, job)?;
        }
        Err(_) => {
            store
                .put_json(
                    &config.minio.bucket,
                    &validation_key,
                    &serde_json::to_vec(&validation).context("encode runtime validation record")?,
                )
                .await
                .context("persist Rust runtime parity validation")?;
        }
    }
    cache.lock().await.insert(cache_key);
    Ok(())
}

async fn verify_persisted_runtime_validation(
    store: &ObjectStore,
    config: &Config,
    job: &InferenceJobManifest,
    validation_key: &str,
) -> Result<()> {
    let existing = store
        .get(&config.minio.bucket, validation_key)
        .await
        .context("load cached runtime validation record")?;
    let prior = serde_json::from_slice::<ModelRuntimeValidationRecord>(&existing)
        .context("decode cached runtime validation record")?;
    validate_runtime_validation_record(&prior, job)
}

fn validate_runtime_validation_record(
    validation: &ModelRuntimeValidationRecord,
    job: &InferenceJobManifest,
) -> Result<()> {
    if validation.validation_status != "PASS"
        || validation.validation_record_id != job.runtime_validation_id
        || validation.runtime_package_id != job.runtime_package_id
        || validation.runtime_manifest_sha256 != job.runtime_manifest_sha256
        || validation.engine != "rust-inference-ort"
    {
        anyhow::bail!("runtime validation record conflicts with immutable inference job")
    }
    Ok(())
}
