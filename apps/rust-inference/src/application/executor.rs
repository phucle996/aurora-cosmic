use std::io::Write;
use std::path::Path;
use std::time::Instant;

use anyhow::{Context, Result};
use tempfile::{NamedTempFile, TempDir};

use super::qualification::qualify_runtime_package;
use crate::adapters::gold::{decode_gold_batch, open_gold_reader_from_file, GoldRow};
use crate::adapters::storage::ObjectStore;
use crate::config::Config;
use crate::domain::job::InferenceJobManifest;
use crate::domain::prediction::{
    compute_candidate_prediction_id, compute_model_input_sha256, CandidatePredictionRecord,
};
use crate::observer::Metrics;
use crate::runtime::{compute_sha256, stable_sigmoid, OnnxRuntime};

#[derive(Clone, Debug)]
pub struct JobOutput {
    pub key: String,
    pub sha256: String,
    pub rows: usize,
}

pub async fn execute_job(
    store: &ObjectStore,
    config: &Config,
    job: &InferenceJobManifest,
    predicted_at: &str,
    metrics: Option<&Metrics>,
) -> Result<JobOutput> {
    let runtime_dir = runtime_package_dir(&job.runtime_manifest_key)?;
    let runtime_tmp = download_runtime_package(store, &config.minio.bucket, &runtime_dir).await?;
    qualify_runtime_package(store, config, job, runtime_tmp.path()).await?;
    let mut runtime = OnnxRuntime::load_with_device(
        runtime_tmp.path(),
        config.ml.intra_threads,
        &config.ml.device,
    )
    .map_err(anyhow::Error::new)?;
    if runtime.manifest.runtime_package_id != job.runtime_package_id
        || runtime.manifest.task != job.task
        || runtime.manifest.source_model_id != job.model_id
        || runtime.manifest.feature_order != job.feature_names
    {
        anyhow::bail!("runtime package does not match job manifest")
    }

    let download_timer = Instant::now();
    let gold_file = NamedTempFile::new().context("create temporary Gold file")?;
    store
        .download_verified_to_file(
            &config.minio.bucket,
            &job.gold_artifact_key,
            &job.gold_artifact_content_sha256,
            config.ml.max_gold_bytes,
            gold_file.path(),
        )
        .await?;
    if let Some(m) = metrics {
        m.record_stage("download", download_timer.elapsed());
    }

    let infer_timer = Instant::now();
    let reader = open_gold_reader_from_file(gold_file.path())?;

    let output_file = NamedTempFile::new().context("create temporary prediction file")?;
    let output_path = output_file.path().to_path_buf();
    let mut output = std::io::BufWriter::new(
        output_file
            .reopen()
            .context("open temporary prediction file")?,
    );
    let mut processed_rows = 0_usize;
    for batch in reader {
        let batch_rows = decode_gold_batch(
            batch.context("read Gold record batch")?,
            &runtime.manifest.feature_order,
        )?;
        for row in batch_rows {
            let standardized = runtime
                .standardize(&row.raw_features)
                .map_err(anyhow::Error::new)?;
            let input_sha = compute_model_input_sha256(&standardized);
            let model_output = runtime
                .infer_standardized(&standardized)
                .map_err(anyhow::Error::new)?;
            let record =
                build_prediction(job, &runtime, &row, &input_sha, &model_output, predicted_at)?;
            serde_json::to_writer(&mut output, &record)?;
            output.write_all(b"\n")?;
            processed_rows += 1;
        }
    }
    if processed_rows as i64 != job.expected_prediction_count
        || processed_rows as i64 != job.gold_artifact_row_count
    {
        anyhow::bail!("Gold row count does not match job manifest")
    }
    output.flush()?;
    drop(output);
    if let Some(m) = metrics {
        m.record_stage("inference", infer_timer.elapsed());
    }

    let upload_timer = Instant::now();
    let key = format!(
        "predictions/{}/{}/{}/part-00000.jsonl",
        job.task, job.gold_snapshot_id, job.job_id
    );
    let sha256 = compute_sha256(Path::new(&output_path)).map_err(anyhow::Error::new)?;
    store
        .put_file(
            &config.minio.prediction_bucket,
            &key,
            &output_path,
            "application/x-ndjson",
        )
        .await?;
    if let Some(m) = metrics {
        m.record_stage("upload", upload_timer.elapsed());
    }
    Ok(JobOutput {
        key,
        sha256,
        rows: processed_rows,
    })
}

fn runtime_package_dir(key: &str) -> Result<String> {
    let mut parts = key.rsplitn(2, '/');
    let file = parts.next().unwrap_or_default();
    let dir = parts.next().context("runtime manifest key has no parent")?;
    if file != "manifest.json" || dir.is_empty() {
        anyhow::bail!("invalid runtime manifest key")
    }
    Ok(dir.to_string())
}

async fn download_runtime_package(store: &ObjectStore, bucket: &str, dir: &str) -> Result<TempDir> {
    let temp = tempfile::tempdir().context("create runtime temp directory")?;
    for filename in [
        "manifest.json",
        "model.onnx",
        "preprocessing.json",
        "threshold.json",
        "parity-fixture.json",
    ] {
        let bytes = store.get(bucket, &format!("{dir}/{filename}")).await?;
        tokio::fs::write(temp.path().join(filename), bytes).await?;
    }
    Ok(temp)
}

fn build_prediction(
    job: &InferenceJobManifest,
    runtime: &OnnxRuntime,
    row: &GoldRow,
    input_sha: &str,
    output: &[f32],
    predicted_at: &str,
) -> Result<CandidatePredictionRecord> {
    let logit = output.first().context("candidate output is empty")?;
    let score = stable_sigmoid(*logit as f64);
    let (prediction_id, fp) = compute_candidate_prediction_id(
        &job.runtime_package_id,
        &job.gold_snapshot_id,
        &row.source_product_id,
    );
    Ok(CandidatePredictionRecord {
        schema_version: 1,
        prediction_id,
        prediction_fingerprint: fp,
        task: job.task.clone(),
        job_id: job.job_id.clone(),
        gold_snapshot_id: job.gold_snapshot_id.clone(),
        gold_artifact_key: job.gold_artifact_key.clone(),
        source_product_id: row.source_product_id.clone(),
        tic_id: row.tic_id,
        sample_id: row.sample_id.clone(),
        sector: row.sector,
        runtime_package_id: job.runtime_package_id.clone(),
        runtime_validation_id: job.runtime_validation_id.clone(),
        registered_model_id: job.model_id.clone(),
        evaluation_run_id: job.evaluation_run_id.clone(),
        dataset_view_version: job.dataset_view_version.clone(),
        model_input_sha256: input_sha.to_string(),
        raw_logit: *logit as f64,
        candidate_score: score,
        score_definition_version: "candidate-sigmoid-score-v1".to_string(),
        decision_threshold: runtime.threshold(),
        above_threshold: score >= runtime.threshold(),
        predicted_at: predicted_at.to_string(),
        producer: "rust-inference".to_string(),
    })
}
