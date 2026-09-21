use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use async_nats::jetstream::{self, AckKind};
use chrono::Utc;
use futures::StreamExt;
use tokio::sync::Semaphore;
use tokio::task::JoinSet;
use tokio_util::sync::CancellationToken;

use crate::adapters::storage::ObjectStore;
use crate::config::{Config, NatsConfig};
use crate::domain::job::{
    InferenceJobCompletedEvent, InferenceJobManifest, InferenceJobRequestedEvent,
    InferenceJobStatusRecord,
};
use crate::observer::Metrics;

use super::executor::execute_job;
use super::status::{
    error_summary, is_non_retryable_execution_error, persist_status, start_ack_heartbeat,
    status_key, status_record, validate_status,
};

const INFERENCE_STREAM_SUBJECT: &str = "aurora.v1.inference.>";
const MAX_DELIVERIES: i64 = 5;
const RETRY_DELAY: Duration = Duration::from_secs(5);

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
    cancel: CancellationToken,
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

    let heartbeat_cancel = CancellationToken::new();
    let heartbeat = start_ack_heartbeat(
        message.clone(),
        config.nats.ack_wait_secs,
        heartbeat_cancel.clone(),
    );
    let execution = execute_job(&store, config, &job, &started_at, Some(&metrics)).await;
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
                Some(&output),
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
            if terminal {
                let record = status_record(
                    &job,
                    "failed",
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
                // Soft state retry: NAK with delay backoff without polluting object storage
                metrics.record_retry(&job.task);
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
    let subject = "aurora.v1.inference.candidate.completed".to_string();
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
    let (expected_id, expected_fingerprint) = job.compute_fingerprint();
    if job.job_id != expected_id || job.job_fingerprint != expected_fingerprint {
        anyhow::bail!("inference job fingerprint does not match immutable manifest")
    }
    Ok(())
}
