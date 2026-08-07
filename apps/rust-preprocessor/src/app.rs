use anyhow::{Context, Result};
use tokio::signal;
use tokio_util::sync::CancellationToken;

use crate::config::Config;
use crate::consumer;

/// Application entry point.
///
/// Flow:
/// ```text
/// main.rs
///    |
///    v
/// load config
///    |
///    v
/// app::run()
///    |
///    +--> connect NATS
///    |
///    +--> start consumer
///    |
///    +--> wait for shutdown signal
/// ```
pub async fn run(config: Config) -> Result<()> {
    // Connect to NATS.
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

    // Shared cancellation token for graceful shutdown.
    let cancel = CancellationToken::new();
    let cancel_consumer = cancel.clone();

    // Spawn the consumer as a tracked task.
    let cfg_consumer = config.consumer.clone();
    let consumer_task = tokio::spawn(async move {
        if let Err(e) = consumer::run(jetstream, &cfg_consumer, cancel_consumer).await {
            tracing::error!(error = %e, "Consumer task exited with error");
        }
    });

    // Wait for shutdown signal.
    let shutdown_timeout = config.consumer.shutdown_timeout_secs;
    tokio::select! {
        _ = signal::ctrl_c() => {
            tracing::info!("SIGINT received — initiating graceful shutdown");
        }
        _ = wait_sigterm() => {
            tracing::info!("SIGTERM received — initiating graceful shutdown");
        }
    }

    // Signal consumer to stop accepting new work.
    cancel.cancel();

    // Wait for consumer to drain with timeout.
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

    // NATS connection closes cleanly on drop.
    tracing::info!("NATS connection closed");

    Ok(())
}

/// Wait for SIGTERM (Unix only). On non-Unix platforms this never resolves.
async fn wait_sigterm() {
    #[cfg(unix)]
    {
        use signal::unix::{signal, SignalKind};
        let mut stream = signal(SignalKind::terminate()).expect("Failed to bind SIGTERM handler");
        stream.recv().await;
    }
    #[cfg(not(unix))]
    {
        // Non-Unix: only ctrl-c is used for shutdown.
        std::future::pending::<()>().await;
    }
}
