use std::sync::Arc;

use anyhow::{Context, Result};
use tokio::signal;
use tokio_util::sync::CancellationToken;

use crate::config::Config;
use crate::infra::MinioClient;
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

    // 2. Initialize MinIO Infrastructure Client
    tracing::info!(
        minio_endpoint = %config.minio.endpoint,
        minio_bucket = %config.minio.bucket,
        "Initializing MinioClient"
    );

    let minio = Arc::new(
        MinioClient::new(&config.minio).context("Failed to initialize MinIO infrastructure client")?,
    );

    // 3. Shared cancellation token for graceful shutdown
    let cancel = CancellationToken::new();
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
