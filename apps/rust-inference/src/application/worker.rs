use std::collections::HashSet;
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use std::{io::Write, path::Path};

use anyhow::{Context, Result};
use async_nats::jetstream::{self, AckKind};
use chrono::Utc;
use futures::StreamExt;
use tempfile::{NamedTempFile, TempDir};
use tokio::sync::{Mutex, Semaphore};
use tokio::task::JoinSet;
use tokio_util::sync::CancellationToken;

use crate::domain::explanation::{AnomalyExplanation, AnomalyExplanationFeature};
use crate::domain::job::{
    compute_job_fingerprint, InferenceJobCompletedEvent, InferenceJobManifest,
    InferenceJobRequestedEvent, InferenceJobStatusRecord,
};
use crate::domain::prediction::{
    compute_anomaly_prediction_id, compute_candidate_prediction_id, compute_model_input_sha256,
    AnomalyPredictionRecord, CandidatePredictionRecord,
};
use crate::runtime::{
    compute_reconstruction_mse, stable_sigmoid, validate_runtime_package_parity_with_device,
    OnnxRuntime, RuntimeError,
};

use crate::adapters::gold::{decode_gold_batch, open_gold_reader_from_file, GoldRow};
use crate::adapters::storage::ObjectStore;
use crate::config::{Config, NatsConfig};
use crate::observer::Metrics;

const INFERENCE_STREAM_SUBJECT: &str = "aurora.v1.inference.>";
const MAX_DELIVERIES: i64 = 5;
const RETRY_DELAY: Duration = Duration::from_secs(5);
static VALIDATED_RUNTIME_PACKAGES: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

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
                max_deliver: MAX_DELIVERIES,
                max_ack_pending: config.nats.workers.max(1) as i64,
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
        while let Some(result) = tasks.try_join_next() {
            if let Err(error) = result {
                tracing::error!(%error, "inference task panicked");
            }
        }

        // Acquire capacity before pulling. This makes a JetStream delivery and
        // a real execution slot the same bounded resource.
        let permit = tokio::select! {
            _ = cancel.cancelled() => break,
            permit = semaphore.clone().acquire_owned() => match permit {
                Ok(permit) => permit,
                Err(_) => break,
            },
        };
        let mut messages = consumer
            .fetch()
            .max_messages(1)
            .messages()
            .await
            .context("fetch inference message")?;
        let next = tokio::select! {
            _ = cancel.cancelled() => break,
            next = messages.next() => next,
        };
        let Some(next) = next else { continue };
        let message = match next {
            Ok(message) => message,
            Err(error) => {
                tracing::warn!(%error, "failed to receive inference message");
                metrics.record_transport_error();
                continue;
            }
        };
        let pending = message
            .info()
            .map(|info| info.pending as usize)
            .unwrap_or_default();
        metrics.set_queue_depth(pending);
        let task_store = store.clone();
        let task_config = config.clone();
        let task_metrics = metrics.clone();
        let task_js = js.clone();
        tasks.spawn(async move {
            let _permit = permit;
            if let Err(error) =
                process_message(message, task_js, task_store, &task_config, task_metrics).await
            {
                tracing::error!(%error, "inference job failed");
            }
        });
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
    js: jetstream::Context,
    store: Arc<ObjectStore>,
    config: &Config,
    metrics: Arc<Metrics>,
) -> Result<()> {
    let mut observation = metrics.begin("unknown", 0);
    let delivery_attempt = message.info().map(|info| info.delivered).unwrap_or(1);
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
        || event.event_type != "aurora.v1.inference.candidate.requested"
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

    let status_key = status_key(&job.job_id);
    let started_at = match store
        .get(&config.minio.prediction_bucket, &status_key)
        .await
    {
        Ok(bytes) => {
            let existing: InferenceJobStatusRecord =
                serde_json::from_slice(&bytes).context("decode existing inference status")?;
            validate_status(&existing, &job)?;
            if existing.status == "completed" {
                observation.set_rows(existing.processed_rows.unwrap_or_default() as usize);
                publish_completion(&js, config, &job, &existing).await?;
                message
                    .double_ack()
                    .await
                    .map_err(|error| anyhow::anyhow!(error.to_string()))
                    .context("ack previously completed inference job")?;
                observation.set_success();
                return Ok(());
            }
            existing.started_at
        }
        Err(_) => Utc::now().to_rfc3339(),
    };
    persist_status(
        &store,
        &config.minio.prediction_bucket,
        &status_key,
        status_record(&job, "running", delivery_attempt, &started_at, None, None),
    )
    .await?;

    let heartbeat_cancel = CancellationToken::new();
    let heartbeat = start_ack_heartbeat(
        message.clone(),
        config.nats.ack_wait_secs,
        heartbeat_cancel.clone(),
    );
    let execution = execute_job(&store, config, &job, &started_at).await;
    heartbeat_cancel.cancel();
    let _ = heartbeat.await;

    match execution {
        Ok(output) => {
            observation.set_rows(output.rows);
            let completed = status_record(
                &job,
                "completed",
                delivery_attempt,
                &started_at,
                Some(output),
                None,
            );
            persist_status(
                &store,
                &config.minio.prediction_bucket,
                &status_key,
                completed.clone(),
            )
            .await?;
            publish_completion(&js, config, &job, &completed).await?;
            message
                .double_ack()
                .await
                .map_err(|error| anyhow::anyhow!(error.to_string()))
                .context("ack inference job")?;
            tracing::info!(job_id = %job.job_id, rows = job.expected_prediction_count, "inference job completed");
            observation.set_success();
            Ok(())
        }
        Err(error) => {
            let terminal =
                is_non_retryable_execution_error(&error) || delivery_attempt >= MAX_DELIVERIES;
            let status = if terminal { "failed" } else { "retrying" };
            let record = status_record(
                &job,
                status,
                delivery_attempt,
                &started_at,
                None,
                Some(error_summary(&error)),
            );
            persist_status(
                &store,
                &config.minio.prediction_bucket,
                &status_key,
                record.clone(),
            )
            .await?;
            if terminal {
                let dead_letter_key = format!("inference/dead-letters/{}.json", job.job_id);
                persist_status(
                    &store,
                    &config.minio.prediction_bucket,
                    &dead_letter_key,
                    record,
                )
                .await?;
                message
                    .ack_with(AckKind::Term)
                    .await
                    .map_err(|ack_error| anyhow::anyhow!(ack_error.to_string()))?;
            } else {
                message
                    .ack_with(AckKind::Nak(Some(RETRY_DELAY)))
                    .await
                    .map_err(|ack_error| anyhow::anyhow!(ack_error.to_string()))?;
            }
            Err(error)
        }
    }
}

async fn publish_completion(
    js: &jetstream::Context,
    config: &Config,
    job: &InferenceJobManifest,
    status: &InferenceJobStatusRecord,
) -> Result<()> {
    let output_key = status
        .output_key
        .clone()
        .context("completed inference status has no output key")?;
    let output_sha256 = status
        .output_sha256
        .clone()
        .context("completed inference status has no output SHA-256")?;
    let processed_rows = status
        .processed_rows
        .context("completed inference status has no processed row count")?;
    if processed_rows != job.expected_prediction_count {
        anyhow::bail!("completed inference row count conflicts with immutable job")
    }
    let branch = if job.task == "candidate_vetting" {
        "candidate"
    } else {
        "anomaly"
    };
    let subject = format!("aurora.v1.inference.{branch}.completed");
    let event = InferenceJobCompletedEvent {
        schema_version: 1,
        event_id: format!("inference-completed-v1-{}", job.job_id),
        event_type: subject.clone(),
        occurred_at: status.updated_at.clone(),
        task: job.task.clone(),
        job_id: job.job_id.clone(),
        gold_snapshot_id: job.gold_snapshot_id.clone(),
        runtime_package_id: job.runtime_package_id.clone(),
        output_bucket: config.minio.prediction_bucket.clone(),
        output_key,
        output_sha256,
        processed_rows,
        producer: "rust-inference".to_string(),
    };
    let mut headers = async_nats::HeaderMap::new();
    headers.insert("Nats-Msg-Id", event.event_id.as_str());
    js.publish_with_headers(subject, headers, serde_json::to_vec(&event)?.into())
        .await
        .context("publish inference completion event")?
        .await
        .context("persist inference completion event")?;
    Ok(())
}

fn is_non_retryable_execution_error(error: &anyhow::Error) -> bool {
    matches!(
        error.downcast_ref::<RuntimeError>(),
        Some(
            RuntimeError::Json(_)
                | RuntimeError::Integrity(_)
                | RuntimeError::ParityFailed(_)
                | RuntimeError::UnknownFeature(_)
                | RuntimeError::MissingFeature(_)
                | RuntimeError::InvalidPackage(_)
                | RuntimeError::InvalidOutput(_)
                | RuntimeError::Ort(_)
        )
    )
}

#[derive(Clone)]
struct JobOutput {
    key: String,
    sha256: String,
    rows: usize,
}

async fn execute_job(
    store: &ObjectStore,
    config: &Config,
    job: &InferenceJobManifest,
    predicted_at: &str,
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
            if job.task == "astronomical_anomaly_detection" {
                let (prediction_id, _) = compute_anomaly_prediction_id(
                    &job.runtime_package_id,
                    &job.gold_snapshot_id,
                    &row.source_product_id,
                );
                let explanation = build_anomaly_explanation(
                    job,
                    &runtime,
                    &row,
                    &standardized,
                    &input_sha,
                    &model_output,
                    prediction_id,
                )?;
                let explanation_key =
                    format!("explanations/anomaly/{}.json", explanation.prediction_id);
                store
                    .put_json(
                        &config.minio.prediction_bucket,
                        &explanation_key,
                        &serde_json::to_vec(&explanation)?,
                    )
                    .await?;
            }
            let record = build_prediction(
                job,
                &runtime,
                &row,
                &standardized,
                &input_sha,
                &model_output,
                predicted_at,
            )?;
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

    let key = format!(
        "predictions/{}/{}/{}/part-00000.jsonl",
        job.task, job.gold_snapshot_id, job.job_id
    );
    let sha256 =
        crate::runtime::compute_sha256(Path::new(&output_path)).map_err(anyhow::Error::new)?;
    store
        .put_file(
            &config.minio.prediction_bucket,
            &key,
            &output_path,
            "application/x-ndjson",
        )
        .await?;
    Ok(JobOutput {
        key,
        sha256,
        rows: processed_rows,
    })
}

async fn qualify_runtime_package(
    store: &ObjectStore,
    config: &Config,
    job: &InferenceJobManifest,
    package_dir: &Path,
) -> Result<()> {
    let manifest_sha = crate::runtime::compute_sha256(&package_dir.join("manifest.json"))
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
            let prior =
                serde_json::from_slice::<crate::domain::model::ModelRuntimeValidationRecord>(
                    &existing,
                )
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
    let prior =
        serde_json::from_slice::<crate::domain::model::ModelRuntimeValidationRecord>(&existing)
            .context("decode cached runtime validation record")?;
    validate_runtime_validation_record(&prior, job)
}

fn validate_runtime_validation_record(
    validation: &crate::domain::model::ModelRuntimeValidationRecord,
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

fn status_key(job_id: &str) -> String {
    format!("inference/status/{job_id}.json")
}

fn status_record(
    job: &InferenceJobManifest,
    status: &str,
    attempt: i64,
    started_at: &str,
    output: Option<JobOutput>,
    error: Option<String>,
) -> InferenceJobStatusRecord {
    InferenceJobStatusRecord {
        schema_version: 1,
        job_id: job.job_id.clone(),
        job_fingerprint: job.job_fingerprint.clone(),
        task: job.task.clone(),
        status: status.to_string(),
        attempt,
        started_at: started_at.to_string(),
        updated_at: Utc::now().to_rfc3339(),
        output_key: output.as_ref().map(|output| output.key.clone()),
        output_sha256: output.as_ref().map(|output| output.sha256.clone()),
        processed_rows: output.map(|output| output.rows as i64),
        error,
        producer: "rust-inference".to_string(),
    }
}

fn validate_status(status: &InferenceJobStatusRecord, job: &InferenceJobManifest) -> Result<()> {
    if status.schema_version != 1
        || status.job_id != job.job_id
        || status.job_fingerprint != job.job_fingerprint
        || status.task != job.task
    {
        anyhow::bail!("inference status conflicts with immutable job manifest")
    }
    Ok(())
}

async fn persist_status(
    store: &ObjectStore,
    bucket: &str,
    key: &str,
    status: InferenceJobStatusRecord,
) -> Result<()> {
    store
        .put_json(
            bucket,
            key,
            &serde_json::to_vec(&status).context("encode inference status")?,
        )
        .await
}

fn start_ack_heartbeat(
    message: jetstream::Message,
    ack_wait_secs: u64,
    cancel: CancellationToken,
) -> tokio::task::JoinHandle<()> {
    let period = Duration::from_secs((ack_wait_secs / 3).max(1));
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(period);
        interval.tick().await;
        loop {
            tokio::select! {
                _ = cancel.cancelled() => break,
                _ = interval.tick() => {
                    if let Err(error) = message.ack_with(AckKind::Progress).await {
                        tracing::warn!(%error, "failed to extend inference acknowledgement lease");
                    }
                }
            }
        }
    })
}

fn error_summary(error: &anyhow::Error) -> String {
    let text = format!("{error:#}");
    text.chars().take(1024).collect()
}

fn build_anomaly_explanation(
    job: &InferenceJobManifest,
    runtime: &OnnxRuntime,
    row: &GoldRow,
    standardized: &[f32],
    input_sha: &str,
    reconstruction: &[f32],
    prediction_id: String,
) -> Result<AnomalyExplanation> {
    if standardized.len() != reconstruction.len()
        || standardized.len() != runtime.manifest.feature_order.len()
    {
        anyhow::bail!("anomaly explanation feature width mismatch")
    }
    let squared: Vec<f64> = standardized
        .iter()
        .zip(reconstruction)
        .map(|(input, output)| {
            let residual = *input as f64 - *output as f64;
            residual * residual
        })
        .collect();
    let total = squared.iter().sum::<f64>();
    let preprocessing = runtime.preprocessing();
    let mut features = Vec::with_capacity(standardized.len());
    for (index, name) in runtime.manifest.feature_order.iter().enumerate() {
        let gold_value = row.raw_features.get(name).copied().flatten();
        let model_value = gold_value
            .or_else(|| preprocessing.feature_medians.get(name).copied())
            .context(format!("missing model value for feature '{name}'"))?;
        let mean = *preprocessing
            .feature_means
            .get(name)
            .context(format!("missing mean for feature '{name}'"))?;
        let scale = *preprocessing
            .feature_scales
            .get(name)
            .context(format!("missing scale for feature '{name}'"))?;
        let residual = standardized[index] as f64 - reconstruction[index] as f64;
        features.push(AnomalyExplanationFeature {
            name: name.clone(),
            gold_value,
            model_value,
            imputed: gold_value.is_none(),
            mean,
            scale,
            standardized_input: standardized[index] as f64,
            reconstruction: reconstruction[index] as f64,
            residual,
            squared_residual: squared[index],
            contribution: if total > 0.0 {
                squared[index] / total
            } else {
                0.0
            },
        });
    }
    let mse =
        compute_reconstruction_mse(standardized, reconstruction).map_err(anyhow::Error::new)?;
    Ok(AnomalyExplanation {
        schema_version: 1,
        explanation_version: "anomaly-explanation-v1".to_string(),
        prediction_id,
        gold_snapshot_id: job.gold_snapshot_id.clone(),
        gold_artifact_key: job.gold_artifact_key.clone(),
        source_product_id: row.source_product_id.clone(),
        tic_id: row.tic_id,
        sample_id: row.sample_id.clone(),
        sector: row.sector,
        runtime_package_id: job.runtime_package_id.clone(),
        runtime_validation_id: job.runtime_validation_id.clone(),
        registered_model_id: job.model_id.clone(),
        model_version: runtime.manifest.model_version.clone(),
        preprocessing_version: runtime.preprocessing().preprocessing_version.clone(),
        split_id: runtime.preprocessing().split_id.clone(),
        feature_order: runtime.manifest.feature_order.clone(),
        model_input_sha256: input_sha.to_string(),
        reconstruction_mse: mse,
        decision_threshold: runtime.threshold(),
        above_threshold: mse >= runtime.threshold(),
        features,
    })
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
        || event.sector != job.sector
        || event.expected_prediction_count != job.expected_prediction_count
    {
        anyhow::bail!("inference event and job manifest disagree")
    }
    let (expected_id, expected_fingerprint) = compute_job_fingerprint(
        &job.task,
        &job.selection_policy_version,
        &job.gold_snapshot_id,
        &job.gold_manifest_sha256,
        &job.gold_artifact_key,
        &job.gold_artifact_content_sha256,
        &job.runtime_package_id,
        &job.runtime_manifest_sha256,
        &job.runtime_validation_id,
    );
    if job.job_id != expected_id || job.job_fingerprint != expected_fingerprint {
        anyhow::bail!("inference job fingerprint does not match immutable manifest")
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
    predicted_at: &str,
) -> Result<serde_json::Value> {
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
            predicted_at: predicted_at.to_string(),
            producer: "rust-inference".to_string(),
        };
        Ok(serde_json::to_value(record)?)
    } else {
        let mse = compute_reconstruction_mse(standardized, output).map_err(anyhow::Error::new)?;
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
            predicted_at: predicted_at.to_string(),
            producer: "rust-inference".to_string(),
        };
        Ok(serde_json::to_value(record)?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn job() -> InferenceJobManifest {
        InferenceJobManifest {
            schema_version: 1,
            job_id: "inference-job-v1-test".to_string(),
            job_fingerprint: "f".repeat(64),
            task: "candidate_vetting".to_string(),
            selection_policy_version: "candidate-inference-selection-v1".to_string(),
            gold_snapshot_id: "gold-v1-test".to_string(),
            gold_manifest_key: "gold/snapshots/gold-v1-test/manifest.json".to_string(),
            gold_manifest_sha256: "a".repeat(64),
            gold_dataset: "candidate".to_string(),
            gold_schema_version: "gold-candidate-v1".to_string(),
            gold_artifact_key: "gold/candidate/part-0.parquet".to_string(),
            gold_artifact_content_sha256: "b".repeat(64),
            gold_artifact_parquet_sha256: None,
            gold_artifact_size_bytes: None,
            gold_artifact_row_count: 1,
            sector: 1,
            runtime_package_id: "runtime-v1-test".to_string(),
            runtime_manifest_key: "models/runtime/test/manifest.json".to_string(),
            runtime_manifest_sha256: "c".repeat(64),
            runtime_validation_id: "rval-v1-test".to_string(),
            runtime_validation_key: None,
            runtime_validation_sha256: None,
            model_id: "model-v1-test".to_string(),
            model_version: "1.0.0".to_string(),
            evaluation_run_id: "evaluation-v1-test".to_string(),
            dataset_view_version: "gold-v1".to_string(),
            dataset_view_fingerprint: "d".repeat(64),
            feature_names: vec!["feature".to_string()],
            expected_prediction_count: 1,
            created_at: "2026-08-31T00:00:00Z".to_string(),
            producer: "test".to_string(),
        }
    }

    #[test]
    fn completed_status_must_belong_to_the_same_immutable_job() {
        let job = job();
        let mut status = status_record(
            &job,
            "completed",
            1,
            "2026-08-31T00:00:00Z",
            Some(JobOutput {
                key: "predictions/test.jsonl".to_string(),
                sha256: "e".repeat(64),
                rows: 1,
            }),
            None,
        );
        assert!(validate_status(&status, &job).is_ok());
        status.job_fingerprint = "x".repeat(64);
        assert!(validate_status(&status, &job).is_err());
    }

    #[test]
    fn deterministic_runtime_contract_failures_are_not_retried() {
        let integrity =
            anyhow::Error::new(RuntimeError::Integrity("threshold mismatch".to_string()));
        let schema = anyhow::Error::new(RuntimeError::Json(
            serde_json::from_slice::<crate::domain::model::ThresholdConfig>(
                br#"{"schema_version":1,"decision_threshold":0.5}"#,
            )
            .expect_err("strict runtime threshold schema must reject metadata"),
        ));
        let transient = anyhow::Error::new(RuntimeError::Io(std::io::Error::new(
            std::io::ErrorKind::TimedOut,
            "temporary read timeout",
        )));

        assert!(is_non_retryable_execution_error(&integrity));
        assert!(is_non_retryable_execution_error(&schema));
        assert!(!is_non_retryable_execution_error(&transient));
    }
}
