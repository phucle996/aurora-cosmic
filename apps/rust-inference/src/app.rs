use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use tokio::signal;
use tokio_util::sync::CancellationToken;

use crate::config::Config;
use crate::storage::ObjectStore;
use crate::worker;

pub async fn run(config: Config) -> Result<()> {
    tracing::info!(device = %config.ml.device, "Service runner started");
    let nats = async_nats::connect(&config.nats.url)
        .await
        .with_context(|| format!("connect to NATS at {}", config.nats.url))?;
    let js = async_nats::jetstream::new(nats);
    worker::ensure_stream(&js, &config.nats).await?;
    let store = Arc::new(ObjectStore::new(&config.minio));
    let cancel = CancellationToken::new();
    let worker_cancel = cancel.clone();
    let worker_config = config.clone();
    let worker_store = store.clone();
    let worker_js = js.clone();
    let worker_task = tokio::spawn(async move {
        worker::run_pool(worker_js, worker_store, worker_config, worker_cancel).await
    });

    tokio::select! {
        result = worker_task => {
            result.context("inference worker task panicked")??;
        }
        _ = signal::ctrl_c() => {
            tracing::info!("Shutdown signal received, stopping inference runtime...");
            cancel.cancel();
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }

    Ok(())
}
