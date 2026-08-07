use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use async_nats::jetstream::{self, consumer::pull::Config as PullConfig};
use tokio::sync::Semaphore;
use tokio::task::JoinSet;
use tokio_util::sync::CancellationToken;

use crate::config::{ConsumerConfig, ImageConfig, LightCurveConfig};
use crate::infra::MinioClient;
use crate::worker::process_message;

/// Subjects to subscribe from AURORA_BRONZE stream.
const BRONZE_FILTER_SUBJECT: &str = "aurora.v1.bronze.*.ready";

/// Run the Tokio Parallel Worker Pool.
pub async fn run_pool(
    jetstream: jetstream::Context,
    minio: Arc<MinioClient>,
    cfg: &ConsumerConfig,
    lc_cfg: LightCurveConfig,
    img_cfg: ImageConfig,
    cancel: CancellationToken,
) -> Result<()> {
    let stream = jetstream.get_stream(&cfg.stream).await.with_context(|| {
        format!(
            "Stream '{}' not found — ensure Stage 2 infrastructure is running",
            cfg.stream
        )
    })?;

    tracing::info!(
        stream = %cfg.stream,
        durable = %cfg.durable,
        workers = cfg.workers,
        subject = BRONZE_FILTER_SUBJECT,
        "Worker pool starting"
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
                tracing::info!("Shutdown signal received — stopping worker pool fetch");
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

                    let minio_ref = minio.clone();
                    let js_ref = jetstream.clone();
                    let tmp_dir = cfg.tmp_dir.clone();
                    let lc_config = lc_cfg.clone();
                    let img_config = img_cfg.clone();

                    let batch_permit = if tasks.is_empty() {
                        Some(permit)
                    } else {
                        None
                    };

                    tasks.spawn(async move {
                        process_message(
                            msg,
                            minio_ref,
                            js_ref,
                            tmp_dir,
                            lc_config,
                            img_config,
                            batch_permit,
                        )
                        .await;
                    });

                    break;
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
