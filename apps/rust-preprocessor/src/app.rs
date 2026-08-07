use std::sync::Arc;

use anyhow::{Context, Result};
use tokio::signal;
use tokio_util::sync::CancellationToken;

use crate::config::Config;
use crate::consumer;
use crate::storage::StorageClient;

/// Application entry point.
///
/// Flow:
/// ```text
/// main.rs -> config -> app::run() -> NATS + MinIO -> consumer::run() -> shutdown
/// ```
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

    // 2. Initialize MinIO / S3 StorageClient once at startup
    tracing::info!(
        minio_endpoint = %config.minio.endpoint,
        minio_bucket = %config.minio.bucket,
        "Initializing StorageClient"
    );

    let storage = Arc::new(
        StorageClient::new(&config.minio)
            .context("Failed to initialize MinIO StorageClient")?,
    );

    // 3. Shared cancellation token for graceful shutdown
    let cancel = CancellationToken::new();
    let cancel_consumer = cancel.clone();

    // 4. Spawn consumer task
    let cfg_consumer = config.consumer.clone();
    let lc_config = config.lc_pipeline.clone();
    let consumer_task = tokio::spawn(async move {
        if let Err(e) = consumer::run(jetstream, storage, &cfg_consumer, lc_config, cancel_consumer).await {
            tracing::error!(error = %e, "Consumer task exited with error");
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

    // 6. Signal consumer to stop accepting new work
    cancel.cancel();

    let drain_result = tokio::time::timeout(
        std::time::Duration::from_secs(shutdown_timeout),
        consumer_task,
    )
    .await;

    match drain_result {
        Ok(Ok(())) => tracing::info!("Consumer drained cleanly"),
        Ok(Err(e)) => tracing::error!(error = %e, "Consumer task panicked during drain"),
        Err(_) => tracing::warn!(
            timeout_secs = shutdown_timeout,
            "Shutdown drain timeout exceeded — forcing exit"
        ),
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
