use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use async_nats::jetstream::{self, AckKind};
use chrono::Utc;
use futures::StreamExt;
use tempfile::TempDir;
use tokio::sync::Semaphore;
use tokio::task::JoinSet;

use crate::domain::job::{InferenceJobManifest, InferenceJobRequestedEvent};
use crate::domain::prediction::{
    compute_anomaly_prediction_id, compute_candidate_prediction_id, compute_model_input_sha256,
    AnomalyPredictionRecord, CandidatePredictionRecord,
};
use crate::runtime::{
    compute_reconstruction_mse, stable_sigmoid, validate_runtime_package_parity, OnnxRuntime,
};

use crate::adapters::gold::{read_gold, GoldRow};
use crate::adapters::storage::ObjectStore;
use crate::config::{Config, NatsConfig};
use crate::observer::Metrics;

const INFERENCE_STREAM_SUBJECT: &str = "aurora.v1.inference.>";

pub async fn ensure_stream(
    js: &jetstream::Context,
    config: &NatsConfig,
) -> Result<jetstream::stream::Stream> {
    js.get_or_create_stream(jetstream::stream::Config {
        name: config.stream.clone(),
        subjects: vec![INFERENCE_STREAM_SUBJECT.to_string()],
        storage: jetstream::stream::StorageType::File,
        retention: jetstream::stream::RetentionPolicy::Limits,
        duplicate_window: Duration::from_secs(24 * 60 * 60),
        ..Default::default()
    })
    .await
    .context("ensure inference JetStream")
}

pub async fn run_pool(
    js: jetstream::Context,
    store: Arc<ObjectStore>,
    config: Config,
    cancel: tokio_util::sync::CancellationToken,
    metrics: Arc<Metrics>,
) -> Result<()> {
    let stream = ensure_stream(&js, &config.nats).await?;
    let consumer = stream
        .get_or_create_consumer(
            &config.nats.durable,
            jetstream::consumer::pull::Config {
                durable_name: Some(config.nats.durable.clone()),
                filter_subject: config.nats.subject.clone(),
                ack_policy: jetstream::consumer::AckPolicy::Explicit,
                ack_wait: Duration::from_secs(config.nats.ack_wait_secs),
                max_deliver: 5,
                ..Default::default()
            },
        )
        .await
        .context("ensure inference JetStream consumer")?;

    let workers = config.nats.workers.max(1);
    let semaphore = Arc::new(Semaphore::new(workers));
    let mut tasks = JoinSet::new();
    tracing::info!(stream = %config.nats.stream, durable = %config.nats.durable, workers, "Inference worker pool ready");

    loop {
        tokio::select! {
            _ = cancel.cancelled() => break,
            _ = tokio::time::sleep(Duration::from_millis(1)) => {
                let messages = consumer.fetch().max_messages(workers).messages().await
                    .context("fetch inference messages")?;
                let batch: Vec<_> = messages.take(workers).collect().await;
                if batch.is_empty() {
                    tokio::time::sleep(Duration::from_millis(250)).await;
                    continue;
                }
                metrics.set_queue_depth(batch.len());
                for message in batch {
                    let message = match message {
                        Ok(message) => message,
                        Err(error) => {
                            tracing::warn!(%error, "failed to receive inference message");
                            metrics.record_transport_error();
                            continue;
                        }
                    };
                    let task_store = store.clone();
                    let task_config = config.clone();
                    let task_semaphore = semaphore.clone();
                    let task_metrics = metrics.clone();
                    tasks.spawn(async move {
                        let _permit = match task_semaphore.acquire_owned().await {
                            Ok(permit) => permit,
                            Err(_) => return,
                        };
                        if let Err(error) = process_message(message, task_store, &task_config, task_metrics).await {
                            tracing::error!(%error, "inference job failed");
                        }
                    });
                }
                metrics.set_queue_depth(0);
                while let Some(result) = tasks.try_join_next() {
                    if let Err(error) = result { tracing::error!(%error, "inference task panicked"); }
                }
            }
        }
    }
    while let Some(result) = tasks.join_next().await {
        if let Err(error) = result {
            tracing::error!(%error, "inference task panicked during shutdown");
        }
    }
    Ok(())
}

async fn process_message(
    message: jetstream::Message,
    store: Arc<ObjectStore>,
    config: &Config,
    metrics: Arc<Metrics>,
) -> Result<()> {
    let mut observation = metrics.begin("unknown", 0);
    let event: InferenceJobRequestedEvent = match serde_json::from_slice(&message.payload) {
        Ok(event) => event,
        Err(error) => {
            tracing::error!(%error, "invalid inference event; terminating message");
            message
                .ack_with(AckKind::Term)
                .await
                .map_err(|error| anyhow::anyhow!(error.to_string()))?;
            return Ok(());
        }
    };
    if event.schema_version != 1
        || !matches!(
            event.event_type.as_str(),
            "aurora.v1.inference.candidate.requested" | "aurora.v1.inference.anomaly.requested"
        )
        || event.expected_prediction_count <= 0
    {
        message
            .ack_with(AckKind::Term)
            .await
            .map_err(|error| anyhow::anyhow!(error.to_string()))?;
        anyhow::bail!("invalid inference event contract")
    }
    observation.set_task(&event.task);

    let job_bytes = store
        .get_verified(
            &event.job_manifest_bucket,
            &event.job_manifest_key,
            &event.job_manifest_sha256,
            16 * 1024 * 1024,
        )
        .await?;
    let job: InferenceJobManifest =
        serde_json::from_slice(&job_bytes).context("decode job manifest")?;
    validate_event_against_job(&event, &job)?;

    let runtime_dir = runtime_package_dir(&job.runtime_manifest_key)?;
    let runtime_tmp = download_runtime_package(&store, &config.minio.bucket, &runtime_dir).await?;
    let validation = validate_runtime_package_parity(runtime_tmp.path())
        .map_err(|error| anyhow::anyhow!(error.to_string()))?;
    if validation.validation_status != "PASS"
        || validation.runtime_manifest_sha256 != job.runtime_manifest_sha256
    {
        anyhow::bail!("runtime package parity validation does not match job manifest")
    }
    let mut runtime = OnnxRuntime::load_with_device(
        runtime_tmp.path(),
        config.ml.intra_threads,
        &config.ml.device,
    )
    .map_err(|error| anyhow::anyhow!(error.to_string()))?;
    if runtime.manifest.runtime_package_id != job.runtime_package_id
        || runtime.manifest.task != job.task
        || runtime.manifest.source_model_id != job.model_id
    {
        anyhow::bail!("runtime package does not match job manifest")
    }

    let gold_bytes = store
        .get_verified(
            &config.minio.bucket,
            &job.gold_artifact_key,
            &job.gold_artifact_content_sha256,
            config.ml.max_gold_bytes,
        )
        .await?;
    let rows = read_gold(gold_bytes, &runtime.manifest.feature_order)?;
    if rows.len() as i64 != job.expected_prediction_count
        || rows.len() as i64 != job.gold_artifact_row_count
    {
        anyhow::bail!("Gold row count does not match job manifest")
    }
    observation.set_rows(rows.len());

    let mut output = Vec::with_capacity(rows.len() * 512);
    for row in rows {
        let standardized = runtime
            .standardize(&row.raw_features)
            .map_err(|error| anyhow::anyhow!(error.to_string()))?;
        let input_sha = compute_model_input_sha256(&standardized);
        let model_output = runtime
            .infer_standardized(&standardized)
            .map_err(|error| anyhow::anyhow!(error.to_string()))?;
        let record = build_prediction(
            &job,
            &runtime,
            &row,
            &standardized,
            &input_sha,
            &model_output,
        )?;
        serde_json::to_writer(&mut output, &record)?;
        output.push(b'\n');
    }

    let key = format!(
        "predictions/{}/{}/{}/part-00000.jsonl",
        job.task, job.gold_snapshot_id, job.job_id
    );
    store
        .put_json(&config.minio.prediction_bucket, &key, &output)
        .await?;
    message
        .ack()
        .await
        .map_err(|error| anyhow::anyhow!(error.to_string()))
        .context("ack inference job")?;
    tracing::info!(job_id = %job.job_id, rows = job.expected_prediction_count, output_key = %key, "inference job completed");
    observation.set_success();
    Ok(())
}

fn validate_event_against_job(
    event: &InferenceJobRequestedEvent,
    job: &InferenceJobManifest,
) -> Result<()> {
    if job.schema_version != 1
        || event.job_id != job.job_id
        || event.task != job.task
        || event.runtime_package_id != job.runtime_package_id
        || event.gold_snapshot_id != job.gold_snapshot_id
        || event.gold_artifact_key != job.gold_artifact_key
        || event.expected_prediction_count != job.expected_prediction_count
    {
        anyhow::bail!("inference event and job manifest disagree")
    }
    Ok(())
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
    standardized: &[f32],
    input_sha: &str,
    output: &[f32],
) -> Result<serde_json::Value> {
    let predicted_at = Utc::now().to_rfc3339();
    if job.task == "candidate_vetting" {
        let logit = output.first().context("candidate output is empty")?;
        let score = stable_sigmoid(*logit as f64);
        let (prediction_id, fp) = compute_candidate_prediction_id(
            &job.runtime_package_id,
            &job.gold_snapshot_id,
            &row.source_product_id,
        );
        let record = CandidatePredictionRecord {
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
            predicted_at,
            producer: "rust-inference".to_string(),
        };
        Ok(serde_json::to_value(record)?)
    } else {
        let mse = compute_reconstruction_mse(standardized, output)
            .map_err(|error| anyhow::anyhow!(error.to_string()))?;
        let (prediction_id, fp) = compute_anomaly_prediction_id(
            &job.runtime_package_id,
            &job.gold_snapshot_id,
            &row.source_product_id,
        );
        let record = AnomalyPredictionRecord {
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
            reconstruction_mse: mse,
            score_definition_version: "reconstruction-mse-v1".to_string(),
            decision_threshold: runtime.threshold(),
            above_threshold: mse >= runtime.threshold(),
            predicted_at,
            producer: "rust-inference".to_string(),
        };
        Ok(serde_json::to_value(record)?)
    }
}
