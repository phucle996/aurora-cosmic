use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use tokio::signal;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

use crate::config::Config;
use crate::infra::MinioClient;
use crate::observer;
use crate::worker;

#[derive(Debug, Clone, Deserialize)]
struct PreprocessingControlCommand {
    action: String,
    job_id: String,
    #[serde(default = "default_mode")]
    mode: String,
    #[serde(default)]
    ingest_run_id: Option<String>,
    #[serde(default)]
    prefix: Option<String>,
}

#[derive(Debug, Serialize)]
struct PreprocessingRunCheckpoint {
    schema_version: u32,
    run_id: String,
    status: String,
    mode: String,
    ingest_run_id: Option<String>,
    prefix: Option<String>,
    started_at: String,
    updated_at: String,
}

fn default_mode() -> String {
    "stream".to_string()
}

/// Application entry point.
pub async fn run(config: Config) -> Result<()> {
    // 1. Connect to NATS
    tracing::info!(
        nats_url = %config.nats.url,
        "Connecting to NATS"
    );

    let nats_client = async_nats::connect(&config.nats.url)
        .await
        .with_context(|| format!("Failed to connect to NATS at '{}'", config.nats.url))?;

    tracing::info!(
        service = "aurora-preprocessor",
        nats = %config.nats.url,
        status = "connected",
        "NATS connection established"
    );

    let jetstream = async_nats::jetstream::new(nats_client.clone());

    // The preprocessor is the producer of Silver events. Ensure its output
    // stream exists independently of the ingester's lifecycle so a fresh
    // deployment cannot create durable Parquet artifacts and then loop on
    // NAKs because the downstream event stream is missing.
    jetstream
        .get_or_create_stream(async_nats::jetstream::stream::Config {
            name: "AURORA_SILVER".to_string(),
            subjects: vec!["aurora.v1.silver.>".to_string()],
            storage: async_nats::jetstream::stream::StorageType::File,
            retention: async_nats::jetstream::stream::RetentionPolicy::Limits,
            duplicate_window: Duration::from_secs(24 * 60 * 60),
            description: Some("Durable Silver preprocessing output events".to_string()),
            ..Default::default()
        })
        .await
        .context("Failed to ensure AURORA_SILVER JetStream")?;

    tracing::info!(stream = "AURORA_SILVER", "Silver event stream ready");

    // 2. Initialize MinIO Infrastructure Client
    tracing::info!(
        minio_endpoint = %config.minio.endpoint,
        minio_bucket = %config.minio.bucket,
        "Initializing MinioClient"
    );

    let minio = Arc::new(
        MinioClient::new(&config.minio)
            .context("Failed to initialize MinIO infrastructure client")?,
    );

    // Both Bronze staging and Silver Parquet serialization use this directory.
    // Create it explicitly so a fresh container does not NAK every message on
    // its first tempfile allocation.
    tokio::fs::create_dir_all(&config.consumer.tmp_dir)
        .await
        .with_context(|| {
            format!(
                "Failed to create preprocessing temp directory {}",
                config.consumer.tmp_dir.display()
            )
        })?;

    // 3. Shared cancellation token and low-cardinality Prometheus observer
    let cancel = CancellationToken::new();
    let metrics =
        Arc::new(observer::Metrics::new().context("Failed to initialize observer metrics")?);
    let observer_task =
        observer::start(&config.observer.addr, Arc::clone(&metrics), cancel.clone())
            .await
            .map_err(|error| {
                anyhow::anyhow!(
                    "Failed to bind observer endpoint at {}: {error}",
                    config.observer.addr
                )
            })?;

    // 4. Subscribe to explicit preprocessing control commands. The service
    // remains idle until the API/UI sends a start command; Bronze events stay
    // durable in JetStream while the worker is stopped.
    let mut control_subscription = nats_client
        .subscribe(config.control.subject.clone())
        .await
        .with_context(|| format!("Failed to subscribe to {}", config.control.subject))?;
    let mut worker_task: Option<JoinHandle<()>> = None;

    if config.control.autostart {
        let now = chrono::Utc::now().to_rfc3339();
        let command = PreprocessingControlCommand {
            action: "start".to_string(),
            job_id: format!("preprocess-autostart-{}", uuid::Uuid::new_v4()),
            mode: "stream".to_string(),
            ingest_run_id: None,
            prefix: None,
        };
        let checkpoint = PreprocessingRunCheckpoint {
            schema_version: 1,
            run_id: command.job_id.clone(),
            status: "RUNNING".to_string(),
            mode: command.mode.clone(),
            ingest_run_id: command.ingest_run_id.clone(),
            prefix: command.prefix.clone(),
            started_at: now.clone(),
            updated_at: now,
        };
        minio
            .put_json_object(
                &config.minio.bucket,
                "checkpoints/preprocessing/current.json",
                &serde_json::json!({"active_run_id": command.job_id}),
            )
            .await
            .context("Failed to write preprocessing checkpoint pointer")?;
        minio
            .put_json_object(
                &config.minio.bucket,
                &format!("checkpoints/preprocessing/runs/{}.json", checkpoint.run_id),
                &checkpoint,
            )
            .await
            .context("Failed to write preprocessing run checkpoint")?;
        let cfg_consumer = config.consumer.clone();
        let lc_config = config.lc_pipeline.clone();
        let img_config = config.image_pipeline.clone();
        let jetstream_ref = jetstream.clone();
        let minio_ref = Arc::clone(&minio);
        let cancel_ref = cancel.clone();
        let metrics_ref = Arc::clone(&metrics);
        let mode = command.mode.clone();
        worker_task = Some(tokio::spawn(async move {
            if let Err(e) = worker::run_pool(
                jetstream_ref,
                minio_ref,
                &cfg_consumer,
                lc_config,
                img_config,
                cancel_ref,
                metrics_ref,
                &mode,
            )
            .await
            {
                tracing::error!(error = %e, "Worker pool exited with error");
            }
        }));
    }

    // 5. Wait for shutdown or an explicit start command.
    let shutdown_timeout = config.consumer.shutdown_timeout_secs;
    let mut sigterm = Box::pin(wait_sigterm());
    loop {
        tokio::select! {
            _ = signal::ctrl_c() => {
                tracing::info!("SIGINT received — initiating graceful shutdown");
                break;
            }
            _ = &mut sigterm => {
                tracing::info!("SIGTERM received — initiating graceful shutdown");
                break;
            }
            command = control_subscription.next() => {
                let Some(message) = command else {
                    tracing::warn!("Preprocessing control subscription closed");
                    break;
                };
                match serde_json::from_slice::<PreprocessingControlCommand>(&message.payload) {
                    Ok(command) if command.action == "start" => {
                        // Batch workers terminate after the retained Bronze backlog is drained.
                        // Reclaim their completed handle so a later UI start can launch a new
                        // independent run without restarting the service.
                        if worker_task
                            .as_ref()
                            .map(JoinHandle::is_finished)
                            .unwrap_or(false)
                        {
                            worker_task.take();
                            tracing::info!("Previous preprocessing worker completed; accepting a new start");
                        }
                        if worker_task.is_some() {
                            tracing::warn!(job_id = %command.job_id, "Preprocessing worker is already running; ignoring duplicate start");
                        } else {
                            let now = chrono::Utc::now().to_rfc3339();
                            let checkpoint = PreprocessingRunCheckpoint {
                                schema_version: 1,
                                run_id: command.job_id.clone(),
                                status: "RUNNING".to_string(),
                                mode: command.mode.clone(),
                                ingest_run_id: command.ingest_run_id.clone(),
                                prefix: command.prefix.clone(),
                                started_at: now.clone(),
                                updated_at: now,
                            };
                            minio
                                .put_json_object(&config.minio.bucket, "checkpoints/preprocessing/current.json", &serde_json::json!({"active_run_id": command.job_id}))
                                .await
                                .context("Failed to write preprocessing checkpoint pointer")?;
                            minio
                                .put_json_object(&config.minio.bucket, &format!("checkpoints/preprocessing/runs/{}.json", checkpoint.run_id), &checkpoint)
                                .await
                                .context("Failed to write preprocessing run checkpoint")?;
                            let cfg_consumer = config.consumer.clone();
                            let lc_config = config.lc_pipeline.clone();
                            let img_config = config.image_pipeline.clone();
                            let jetstream_ref = jetstream.clone();
                            let minio_ref = Arc::clone(&minio);
                            let cancel_ref = cancel.clone();
                            let metrics_ref = Arc::clone(&metrics);
                            let mode = command.mode.clone();
                            worker_task = Some(tokio::spawn(async move {
                                if let Err(e) = worker::run_pool(jetstream_ref, minio_ref, &cfg_consumer, lc_config, img_config, cancel_ref, metrics_ref, &mode).await {
                                    tracing::error!(error = %e, "Worker pool exited with error");
                                }
                            }));
                            tracing::info!(job_id = %command.job_id, mode = %command.mode, "Preprocessing workflow started");
                        }
                    }
                    Ok(command) => tracing::warn!(action = %command.action, "Unsupported preprocessing control action"),
                    Err(error) => tracing::warn!(error = %error, "Invalid preprocessing control command"),
                }
            }
        }
    }

    // 6. Signal worker pool to stop accepting new work
    cancel.cancel();

    if let Some(worker_task) = worker_task {
        let drain_result = tokio::time::timeout(
            std::time::Duration::from_secs(shutdown_timeout),
            worker_task,
        )
        .await;

        match drain_result {
            Ok(Ok(())) => tracing::info!("Worker pool drained cleanly"),
            Ok(Err(e)) => tracing::error!(error = %e, "Worker pool task panicked during drain"),
            Err(_) => tracing::warn!(
                timeout_secs = shutdown_timeout,
                "Shutdown drain timeout exceeded — forcing exit"
            ),
        }
    }

    if let Err(error) = observer_task.await {
        tracing::warn!(error = %error, "Observer task exited unexpectedly");
    }

    tracing::info!("NATS connection closed");
    Ok(())
}

async fn wait_sigterm() {
    #[cfg(unix)]
    {
        use signal::unix::{signal, SignalKind};
        let mut stream = signal(SignalKind::terminate()).expect("Failed to bind SIGTERM handler");
        stream.recv().await;
    }
    #[cfg(not(unix))]
    {
        std::future::pending::<()>().await;
    }
}
