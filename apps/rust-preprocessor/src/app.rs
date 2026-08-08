use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use tokio::signal;
use tokio_util::sync::CancellationToken;

use crate::config::Config;
use crate::infra::MinioClient;
use crate::observer;
use crate::worker;

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

    let cancel_worker = cancel.clone();

    // 4. Spawn Tokio Worker Pool
    let cfg_consumer = config.consumer.clone();
    let lc_config = config.lc_pipeline.clone();
    let img_config = config.image_pipeline.clone();
    let worker_task = tokio::spawn(async move {
        if let Err(e) = worker::run_pool(
            jetstream,
            minio,
            &cfg_consumer,
            lc_config,
            img_config,
            cancel_worker,
            metrics,
        )
        .await
        {
            tracing::error!(error = %e, "Worker pool exited with error");
        }
    });

    // 5. Wait for shutdown signal
    let shutdown_timeout = config.consumer.shutdown_timeout_secs;
    tokio::select! {
        _ = signal::ctrl_c() => {
            tracing::info!("SIGINT received — initiating graceful shutdown");
        }
        _ = wait_sigterm() => {
            tracing::info!("SIGTERM received — initiating graceful shutdown");
        }
    }

    // 6. Signal worker pool to stop accepting new work
    cancel.cancel();

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
