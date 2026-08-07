use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use async_nats::jetstream::{self, consumer::pull::Config as PullConfig, AckKind};
use tokio::sync::Semaphore;
use tokio::task::JoinSet;
use tokio_util::sync::CancellationToken;

use crate::config::ConsumerConfig;
use crate::event::BronzeObjectReady;
use crate::fits::{self, DecodedSource};
use crate::storage::StorageClient;

/// Subjects to subscribe from AURORA_BRONZE stream.
const BRONZE_FILTER_SUBJECT: &str = "aurora.v1.bronze.*.ready";

/// Run the JetStream consumer with bounded Tokio concurrency.
pub async fn run(
    jetstream: jetstream::Context,
    storage: Arc<StorageClient>,
    cfg: &ConsumerConfig,
    cancel: CancellationToken,
) -> Result<()> {
    let stream = jetstream
        .get_stream(&cfg.stream)
        .await
        .with_context(|| format!("Stream '{}' not found — ensure Stage 2 infrastructure is running", cfg.stream))?;

    tracing::info!(
        stream = %cfg.stream,
        durable = %cfg.durable,
        workers = cfg.workers,
        subject = BRONZE_FILTER_SUBJECT,
        "JetStream consumer starting"
    );

    let consumer = stream
        .get_or_create_consumer(
            &cfg.durable,
            PullConfig {
                durable_name: Some(cfg.durable.clone()),
                filter_subject: BRONZE_FILTER_SUBJECT.to_string(),
                ack_policy: async_nats::jetstream::consumer::AckPolicy::Explicit,
                ack_wait: parse_duration(&cfg.ack_wait),
                max_deliver: 10,
                ..Default::default()
            },
        )
        .await
        .context("Failed to create/open durable JetStream consumer")?;

    tracing::info!(
        durable = %cfg.durable,
        subjects = BRONZE_FILTER_SUBJECT,
        "Durable consumer ready"
    );

    let semaphore = Arc::new(Semaphore::new(cfg.workers));
    let mut tasks: JoinSet<()> = JoinSet::new();
    let fetch_size = cfg.workers;

    loop {
        tokio::select! {
            biased;

            _ = cancel.cancelled() => {
                tracing::info!("Shutdown signal received — stopping message fetch");
                break;
            }

            permit = semaphore.clone().acquire_owned() => {
                let permit = match permit {
                    Ok(p) => p,
                    Err(_) => break,
                };

                let messages = match consumer
                    .fetch()
                    .max_messages(fetch_size)
                    .messages()
                    .await
                {
                    Ok(msgs) => msgs,
                    Err(e) => {
                        tracing::error!(error = %e, "Failed to fetch messages from JetStream");
                        drop(permit);
                        tokio::time::sleep(Duration::from_secs(1)).await;
                        continue;
                    }
                };

                use futures::StreamExt;
                let msgs: Vec<_> = messages.take(fetch_size).collect().await;

                if msgs.is_empty() {
                    drop(permit);
                    tokio::time::sleep(Duration::from_millis(500)).await;
                    continue;
                }

                for msg_result in msgs {
                    let msg = match msg_result {
                        Ok(m) => m,
                        Err(e) => {
                            tracing::warn!(error = %e, "Failed to receive message from fetch batch");
                            continue;
                        }
                    };

                    let storage_ref = storage.clone();
                    let tmp_dir = cfg.tmp_dir.clone();

                    let batch_permit = if tasks.len() == 0 {
                        Some(permit)
                    } else {
                        None
                    };

                    tasks.spawn(async move {
                        process_message(msg, storage_ref, tmp_dir, batch_permit).await;
                    });

                    break;
                }

                while let Some(result) = tasks.try_join_next() {
                    if let Err(e) = result {
                        tracing::error!(error = %e, "Processing task panicked — message was not ACKed");
                    }
                }
            }
        }
    }

    tracing::info!(active_tasks = tasks.len(), "Draining active processing tasks");
    while let Some(result) = tasks.join_next().await {
        if let Err(e) = result {
            tracing::error!(error = %e, "Processing task panicked during shutdown drain");
        }
    }

    tracing::info!("Consumer shutdown complete");
    Ok(())
}

/// Process one JetStream message:
/// 1. Decode event JSON
/// 2. Stat & verify object size in MinIO Bronze
/// 3. Stream object to temp file & verify SHA-256 checksum on the fly
/// 4. spawn_blocking FITS decode
/// 5. ACK on success, NAK on error
async fn process_message(
    msg: async_nats::jetstream::Message,
    storage: Arc<StorageClient>,
    tmp_dir: PathBuf,
    _permit: Option<tokio::sync::OwnedSemaphorePermit>,
) {
    let subject = msg.subject.clone();

    tracing::debug!(subject = %subject, "Message received");

    let event = match serde_json::from_slice::<BronzeObjectReady>(&msg.payload) {
        Ok(e) => e,
        Err(decode_err) => {
            tracing::warn!(
                subject = %subject,
                error = %decode_err,
                "Failed to decode event — terminating poison message"
            );
            if let Err(e) = msg.ack_with(AckKind::Term).await {
                tracing::error!(error = %e, "Failed to TERM malformed message");
            } else {
                tracing::info!(subject = %subject, lifecycle = "term", "Poison message terminated");
            }
            return;
        }
    };

    let event_id = event.event_id.clone();
    let product_kind = event.product_kind.clone();

    tracing::info!(
        event_id = %event_id,
        product_kind = ?product_kind,
        bucket = %event.bucket,
        object_key = %event.object_key,
        sector = event.sector,
        tic_id = ?event.tic_id,
        "Processing event"
    );

    match process_bronze_event(storage, &tmp_dir, event).await {
        Ok(decoded) => {
            tracing::info!(
                event_id = %event_id,
                product = ?decoded.product,
                lifecycle = "decoded",
                "FITS decoded successfully"
            );

            // TODO Phase 3.5: change ACK boundary to "Silver durable write → ACK"
            if let Err(e) = msg.ack().await {
                tracing::error!(event_id = %event_id, error = %e, "Failed to ACK message");
            } else {
                tracing::info!(event_id = %event_id, lifecycle = "acked", "Event processed and ACKed");
            }
        }
        Err(err) => {
            tracing::warn!(
                event_id = %event_id,
                error = %err,
                lifecycle = "nak",
                "Processing failed — NAKing for redelivery"
            );
            if let Err(e) = msg.ack_with(AckKind::Nak(None)).await {
                tracing::error!(event_id = %event_id, error = %e, "Failed to NAK message");
            }
        }
    }
}

/// Helper function to perform storage fetch, verification, and blocking FITS decode.
pub(crate) async fn process_bronze_event(
    storage: Arc<StorageClient>,
    tmp_dir: &PathBuf,
    event: BronzeObjectReady,
) -> Result<DecodedSource> {
    // 1. Stat & verify object size
    storage
        .stat_and_verify_size(&event.bucket, &event.object_key, event.size_bytes)
        .await?;

    // 2. Fetch to temp file & verify SHA-256 checksum on the fly
    let temp_file = storage
        .fetch_to_temp(
            &event.bucket,
            &event.object_key,
            event.size_bytes,
            &event.sha256,
            tmp_dir,
        )
        .await?;

    // 3. spawn_blocking for CPU/blocking FITS decode
    let event_clone = event.clone();
    let temp_path = temp_file.path.clone();

    let product = tokio::task::spawn_blocking(move || {
        fits::decode(&temp_path, &event_clone)
    })
    .await
    .context("FITS decode task panicked")??;

    // `temp_file` goes out of scope here and automatically deletes the temporary FITS file.

    Ok(DecodedSource {
        event,
        product,
    })
}

pub(crate) fn parse_duration(s: &str) -> Duration {
    if let Some(secs_str) = s.strip_suffix('s') {
        if let Ok(n) = secs_str.parse::<u64>() {
            return Duration::from_secs(n);
        }
    }
    if let Some(mins_str) = s.strip_suffix('m') {
        if let Ok(n) = mins_str.parse::<u64>() {
            return Duration::from_secs(n * 60);
        }
    }
    tracing::warn!(value = s, "Could not parse ack_wait duration — defaulting to 30s");
    Duration::from_secs(30)
}
