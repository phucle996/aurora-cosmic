use std::sync::Arc;
use std::time::Duration;

use anyhow::Result;
use async_nats::jetstream::{self, consumer::pull::Config as PullConfig};
use tokio::sync::Semaphore;
use tokio::task::JoinSet;
use tokio_util::sync::CancellationToken;

use crate::config::{ConsumerConfig, ImageConfig, LightCurveConfig};
use crate::event::{BronzeObjectReady, ProductKind};
use crate::infra::MinioClient;
use crate::observer::Metrics;
use crate::runtime::RuntimeReporter;
use crate::worker::process_message;

/// Subjects to subscribe from AURORA_BRONZE stream.
const BRONZE_FILTER_SUBJECT: &str = "aurora.v1.bronze.*.ready";

/// Run the Tokio Parallel Worker Pool.
#[allow(clippy::too_many_arguments)]
pub async fn run_pool(
    jetstream: jetstream::Context,
    minio: Arc<MinioClient>,
    cfg: &ConsumerConfig,
    lc_cfg: LightCurveConfig,
    img_cfg: ImageConfig,
    cancel: CancellationToken,
    metrics: Arc<Metrics>,
    mode: &str,
    runtime: RuntimeReporter,
    job_id: &str,
) -> Result<()> {
    // The ingester creates AURORA_BRONZE lazily when it publishes the first
    // product. Keep the preprocessor alive while that happens instead of
    // turning a normal Compose startup race into a permanently idle service.
    let stream = loop {
        match jetstream.get_stream(&cfg.stream).await {
            Ok(stream) => break stream,
            Err(error) => {
                tracing::warn!(
                    stream = %cfg.stream,
                    error = %error,
                    retry_in_secs = 1,
                    "JetStream stream unavailable; retrying worker startup"
                );
                tokio::select! {
                    _ = cancel.cancelled() => return Ok(()),
                    _ = tokio::time::sleep(Duration::from_secs(1)) => {}
                }
            }
        }
    };

    tracing::info!(
        stream = %cfg.stream,
        durable = %cfg.durable,
        workers = cfg.workers,
        subject = BRONZE_FILTER_SUBJECT,
        "Worker pool starting"
    );

    let worker_slots = Arc::new(tokio::sync::Mutex::new(
        (1..=cfg.workers)
            .map(|index| format!("preprocess-{index:02}"))
            .collect::<Vec<_>>(),
    ));
    for worker_id in worker_slots.lock().await.iter() {
        runtime.emit(
            "worker_spawned",
            job_id,
            worker_id,
            "idle",
            None,
            None,
            None,
            None,
            None,
        );
    }

    let mut consumer = loop {
        match stream
            .get_or_create_consumer(
                &cfg.durable,
                PullConfig {
                    durable_name: Some(cfg.durable.clone()),
                    filter_subject: BRONZE_FILTER_SUBJECT.to_string(),
                    ack_policy: async_nats::jetstream::consumer::AckPolicy::Explicit,
                    ack_wait: parse_duration(&cfg.ack_wait),
                    max_deliver: cfg.max_deliveries,
                    backoff: cfg
                        .retry_backoff_secs
                        .iter()
                        .map(|&s| std::time::Duration::from_secs(s))
                        .collect(),
                    ..Default::default()
                },
            )
            .await
        {
            Ok(consumer) => break consumer,
            Err(error) => {
                tracing::warn!(
                    durable = %cfg.durable,
                    error = %error,
                    retry_in_secs = 1,
                    "JetStream consumer unavailable; retrying worker startup"
                );
                tokio::select! {
                    _ = cancel.cancelled() => return Ok(()),
                    _ = tokio::time::sleep(Duration::from_secs(1)) => {}
                }
            }
        }
    };

    tracing::info!(
        durable = %cfg.durable,
        subjects = BRONZE_FILTER_SUBJECT,
        "Durable consumer ready"
    );

    let semaphore = Arc::new(Semaphore::new(cfg.workers));
    // A multi-GB FITS currently needs one local FITS staging file because
    // CFITSIO opens a seekable path. Keep those files from exhausting the SSD
    // when a JetStream fetch returns many TPF/FFI products at once.
    let large_staging_slots = Arc::new(Semaphore::new(cfg.large_staging_concurrency));
    let mut tasks: JoinSet<()> = JoinSet::new();
    let fetch_size = cfg.workers;
    let ack_progress_interval = ack_progress_interval(&cfg.ack_wait);

    loop {
        tokio::select! {
            biased;

            _ = cancel.cancelled() => {
                tracing::info!("Shutdown signal received — stopping worker pool fetch");
                break;
            }

            permit = semaphore.clone().acquire_owned() => {
                let permit = match permit {
                    Ok(p) => p,
                    Err(_) => break,
                };

                if let Ok(info) = consumer.info().await {
                    metrics.set_backlog(info.num_pending, info.num_ack_pending);
                }

                let mut fetch = consumer.fetch().max_messages(fetch_size);
                if mode == "batch" {
                    fetch = fetch.expires(Duration::from_secs(2));
                }
                let messages = match fetch.messages().await {
                    Ok(msgs) => msgs,
                    Err(e) => {
                        if mode == "batch" {
                            tracing::info!(error = %e, "Batch preprocessing reached the end of retained Bronze events");
                            break;
                        }
                        tracing::error!(error = %e, "Failed to fetch messages from JetStream");
                        metrics.record_transport_error();
                        drop(permit);
                        tokio::time::sleep(Duration::from_secs(1)).await;
                        continue;
                    }
                };

                use futures::StreamExt;
                let msgs: Vec<_> = messages.take(fetch_size).collect().await;

                if msgs.is_empty() {
                    drop(permit);
                    if mode == "batch" {
                        tracing::info!("Batch preprocessing drained retained Bronze events");
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(500)).await;
                    continue;
                }

                let mut pending_messages = msgs.len();
                metrics.set_queue_depth(pending_messages);

                let mut available_permit = Some(permit);
                for msg_result in msgs {
                    let msg = match msg_result {
                        Ok(m) => m,
                        Err(e) => {
                            tracing::warn!(error = %e, "Failed to receive message from fetch batch");
                            metrics.record_transport_error();
                            pending_messages = pending_messages.saturating_sub(1);
                            metrics.set_queue_depth(pending_messages);
                            continue;
                        }
                    };

                    let minio_ref = minio.clone();
                    let js_ref = jetstream.clone();
                    let tmp_dir = cfg.tmp_dir.clone();
                    let lc_config = lc_cfg.clone();
                    let img_config = img_cfg.clone();
                    let metrics_ref = metrics.clone();
                    let runtime_ref = runtime.clone();
                    let ack_progress_interval_ref = ack_progress_interval;
                    let job_id_ref = job_id.to_string();
                    let slots_ref = Arc::clone(&worker_slots);
                    let large_staging_slots_ref = Arc::clone(&large_staging_slots);

                    // The fetch above may return up to `workers` messages. A
                    // permit is attached to every spawned task so every
                    // fetched message is processed exactly once by this
                    // delivery loop; previously only the first message was
                    // spawned and the rest were left for redelivery.
                    let task_permit = if let Some(permit) = available_permit.take() {
                        permit
                    } else {
                        match semaphore.clone().acquire_owned().await {
                            Ok(permit) => permit,
                            Err(_) => break,
                        }
                    };

                    // A semaphore permit represents one concrete worker slot.
                    // Acquire the ID only after holding the permit and return
                    // it before releasing the permit to avoid an extra,
                    // transient "unassigned" worker under load.
                    let worker_id = slots_ref
                        .lock()
                        .await
                        .pop()
                        .expect("worker slot must exist while a pool permit is held");

                    let large_staging_permit = match serde_json::from_slice::<BronzeObjectReady>(&msg.payload) {
                        Ok(event)
                            if matches!(event.product_kind, ProductKind::TargetPixel | ProductKind::Ffi)
                                && event.size_bytes >= cfg.large_staging_threshold_bytes => {
                            tracing::info!(
                                worker_id = %worker_id,
                                object_key = %event.object_key,
                                size_bytes = event.size_bytes,
                                threshold_bytes = cfg.large_staging_threshold_bytes,
                                max_concurrent = cfg.large_staging_concurrency,
                                "Waiting for large FITS staging admission"
                            );
                            match large_staging_slots_ref.acquire_owned().await {
                                Ok(permit) => Some(permit),
                                Err(_) => break,
                            }
                        }
                        _ => None,
                    };

                    tasks.spawn(async move {
                        process_message(
                            msg,
                            minio_ref,
                            js_ref,
                            tmp_dir,
                            lc_config,
                            img_config,
                            metrics_ref,
                            runtime_ref.clone(),
                            job_id_ref.clone(),
                            worker_id.clone(),
                            ack_progress_interval_ref,
                            large_staging_permit,
                        )
                        .await;
                        runtime_ref.emit("worker_idle", &job_id_ref, &worker_id, "idle", None, None, Some("waiting".to_string()), None, None);
                        slots_ref.lock().await.push(worker_id);
                        drop(task_permit);
                    });
                    pending_messages = pending_messages.saturating_sub(1);
                    metrics.set_queue_depth(pending_messages);
                }

                while let Some(result) = tasks.try_join_next() {
                    if let Err(e) = result {
                        tracing::error!(error = %e, "Worker task panicked");
                    }
                }
            }
        }
    }

    tracing::info!(
        active_tasks = tasks.len(),
        "Draining active worker processing tasks"
    );
    while let Some(result) = tasks.join_next().await {
        if let Err(e) = result {
            tracing::error!(error = %e, "Worker task panicked during shutdown drain");
        }
    }

    tracing::info!("Worker pool shutdown complete");
    for index in 1..=cfg.workers {
        runtime.emit(
            "worker_stopped",
            job_id,
            &format!("preprocess-{index:02}"),
            "stopped",
            None,
            None,
            None,
            None,
            None,
        );
    }
    Ok(())
}

pub fn parse_duration(s: &str) -> Duration {
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
    Duration::from_secs(30)
}

fn ack_progress_interval(ack_wait: &str) -> Duration {
    let ack_seconds = parse_duration(ack_wait).as_secs().max(2);
    Duration::from_secs((ack_seconds / 2).clamp(1, 30))
}
