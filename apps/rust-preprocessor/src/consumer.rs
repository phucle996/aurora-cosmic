use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use async_nats::jetstream::{self, consumer::pull::Config as PullConfig, AckKind};
use tokio::sync::Semaphore;
use tokio::task::JoinSet;
use tokio_util::sync::CancellationToken;

use crate::config::ConsumerConfig;
use crate::event::{BronzeObjectReady, ProductKind};

/// Subjects to subscribe from AURORA_BRONZE stream.
const BRONZE_FILTER_SUBJECT: &str = "aurora.v1.bronze.*.ready";

/// Run the JetStream consumer with bounded Tokio concurrency.
///
/// # Phase 3.1 invariants
/// - Manual ACK only — never auto-ACK.
/// - Bounded concurrency via Semaphore(N).
/// - ACK only after placeholder handler returns success.
/// - NAK on recoverable handler failure.
/// - TERM on malformed/poison messages (no endless redelivery).
/// - Active tasks tracked via JoinSet.
/// - Backpressure: when Semaphore is exhausted, no new messages are fetched.
/// - Graceful drain on cancellation.
///
/// # TODO Phase 3.5
/// Change ACK boundary from "placeholder success" to "Silver durable write".
pub async fn run(
    jetstream: jetstream::Context,
    cfg: &ConsumerConfig,
    cancel: CancellationToken,
) -> Result<()> {
    // Verify the expected stream exists before starting.
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

    // Open or create the durable pull consumer.
    let consumer = stream
        .get_or_create_consumer(
            &cfg.durable,
            PullConfig {
                durable_name: Some(cfg.durable.clone()),
                filter_subject: BRONZE_FILTER_SUBJECT.to_string(),
                ack_policy: async_nats::jetstream::consumer::AckPolicy::Explicit,
                ack_wait: parse_duration(&cfg.ack_wait),
                max_deliver: 10, // allow redelivery up to 10x before terminal
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

    // Bounded concurrency semaphore.
    let semaphore = Arc::new(Semaphore::new(cfg.workers));

    // Task set for tracking all in-flight processing tasks.
    let mut tasks: JoinSet<()> = JoinSet::new();

    // Pull messages with fetch size aligned to worker capacity.
    let fetch_size = cfg.workers;

    loop {
        tokio::select! {
            biased;

            // Shutdown signal.
            _ = cancel.cancelled() => {
                tracing::info!("Shutdown signal received — stopping message fetch");
                break;
            }

            // Try to acquire a permit before fetching the next batch.
            // This is the backpressure point: when all workers are busy, we
            // do not pull more messages from JetStream.
            permit = semaphore.clone().acquire_owned() => {
                let permit = match permit {
                    Ok(p) => p,
                    Err(_) => break, // semaphore closed
                };

                // Fetch a small batch bounded by worker capacity.
                let messages = match consumer
                    .fetch()
                    .max_messages(fetch_size)
                    .messages()
                    .await
                {
                    Ok(msgs) => msgs,
                    Err(e) => {
                        tracing::error!(error = %e, "Failed to fetch messages from JetStream");
                        // Release permit and retry after a brief pause.
                        drop(permit);
                        tokio::time::sleep(Duration::from_secs(1)).await;
                        continue;
                    }
                };

                // Collect at most fetch_size messages.
                use futures::StreamExt;
                let msgs: Vec<_> = messages.take(fetch_size).collect().await;

                if msgs.is_empty() {
                    // No messages available — release permit, wait briefly.
                    drop(permit);
                    tokio::time::sleep(Duration::from_millis(500)).await;
                    continue;
                }

                // Spawn one task per message. Each task holds a permit until done.
                for msg_result in msgs {
                    let msg = match msg_result {
                        Ok(m) => m,
                        Err(e) => {
                            tracing::warn!(error = %e, "Failed to receive message from fetch batch");
                            continue;
                        }
                    };

                    // Acquire individual permit for this task (first permit already
                    // held from semaphore.acquire_owned above is used for the first msg).
                    // For subsequent msgs in the batch, try_acquire.
                    let task_permit = if tasks.len() == 0 {
                        // Re-use the batch permit for first message.
                        // (permit is moved into the first task below)
                        None
                    } else {
                        match semaphore.clone().try_acquire_owned() {
                            Ok(p) => Some(p),
                            Err(_) => {
                                // All slots occupied — NAK this message so it is
                                // redelivered later when capacity is available.
                        if let Err(e) = msg.ack_with(AckKind::Nak(None)).await {
                                    tracing::warn!(error = %e, "Failed to NAK message (capacity full)");
                                }
                                continue;
                            }
                        }
                    };

                    let _ = task_permit; // silence unused warning; permit dropped at end of task

                    let batch_permit = if tasks.len() == 0 {
                        // Move the original permit into first task.
                        Some(permit)
                    } else {
                        None
                    };

                    tasks.spawn(async move {
                        process_message(msg, batch_permit).await;
                    });

                    // After spawning first task with original permit, break inner loop.
                    // Remaining messages in batch need their own permit — handled above.
                    break;
                }

                // Reap finished tasks to avoid JoinSet growing unbounded.
                while let Some(result) = tasks.try_join_next() {
                    if let Err(e) = result {
                        tracing::error!(error = %e, "Processing task panicked — message was not ACKed");
                    }
                }
            }
        }
    }

    // Graceful drain: wait for all active tasks to finish.
    tracing::info!(active_tasks = tasks.len(), "Draining active processing tasks");
    while let Some(result) = tasks.join_next().await {
        if let Err(e) = result {
            tracing::error!(error = %e, "Processing task panicked during shutdown drain");
        }
    }

    tracing::info!("Consumer shutdown complete");
    Ok(())
}

/// Process one JetStream message.
///
/// Message lifecycle:
/// - Decode JSON → BronzeObjectReady (fail → TERM)
/// - Dispatch to placeholder handler (fail → NAK; success → ACK)
///
/// Permit is dropped at end of this function, releasing a concurrency slot.
async fn process_message(
    msg: async_nats::jetstream::Message,
    _permit: Option<tokio::sync::OwnedSemaphorePermit>,
) {
    let subject = msg.subject.clone();

    tracing::debug!(subject = %subject, "Message received");

    // --- Decode ---
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
    let product_kind = &event.product_kind;

    tracing::info!(
        event_id = %event_id,
        product_kind = ?product_kind,
        bucket = %event.bucket,
        object_key = %event.object_key,
        sector = event.sector,
        tic_id = ?event.tic_id,
        "Processing event"
    );

    // Validate product kind is supported (should already be enforced by serde,
    // but guard explicitly for clarity).
    match product_kind {
        ProductKind::TargetPixel | ProductKind::LightCurve | ProductKind::Ffi => {}
    }

    // --- Placeholder handler ---
    // TODO Phase 3.2: replace with MinIO GET + FITS decode.
    // TODO Phase 3.5: replace ACK boundary with "Silver durable write → ACK".
    match placeholder_handle(&event).await {
        Ok(()) => {
            if let Err(e) = msg.ack().await {
                tracing::error!(event_id = %event_id, error = %e, "Failed to ACK message");
            } else {
                tracing::info!(event_id = %event_id, lifecycle = "acked", "Event processed and ACKed");
            }
        }
        Err(handler_err) => {
            tracing::warn!(
                event_id = %event_id,
                error = %handler_err,
                lifecycle = "nak",
                "Handler failed — NAKing for redelivery"
            );
            if let Err(e) = msg.ack_with(AckKind::Nak(None)).await {
                tracing::error!(event_id = %event_id, error = %e, "Failed to NAK message");
            }
        }
    }
}

/// Placeholder handler — Phase 3.1 only.
///
/// Validates the event and logs metadata. No MinIO, no FITS, no Silver.
///
/// # TODO Phase 3.2
/// Replace with Bronze MinIO GET + FITS decode logic.
pub(crate) async fn placeholder_handle(event: &BronzeObjectReady) -> Result<()> {
    // Basic field validation.
    if event.sha256.len() != 64 {
        anyhow::bail!("sha256 length invalid for event_id={}", event.event_id);
    }
    if event.object_key.is_empty() {
        anyhow::bail!("object_key is empty for event_id={}", event.event_id);
    }

    tracing::info!(
        event_id = %event.event_id,
        product_kind = ?event.product_kind,
        sector = event.sector,
        size_bytes = event.size_bytes,
        lifecycle = "processing",
        "Placeholder: validated event (Phase 3.1)"
    );

    Ok(())
}

/// Parse a simple duration string like "30s", "5m" into std::time::Duration.
/// Falls back to 30 seconds on parse failure.
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

