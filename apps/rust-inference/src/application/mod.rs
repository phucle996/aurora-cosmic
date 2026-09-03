mod promotion;
mod worker;

use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use tokio::signal;
use tokio_util::sync::CancellationToken;

use crate::adapters::storage::ObjectStore;
use crate::config::Config;
use crate::observer;

pub async fn run(config: Config) -> Result<()> {
    tracing::info!(device = %config.ml.device, "Service runner started");
    let nats = async_nats::connect(&config.nats.url)
        .await
        .with_context(|| format!("connect to NATS at {}", config.nats.url))?;
    let js = async_nats::jetstream::new(nats.clone());
    worker::ensure_stream(&js, &config.nats).await?;
    let store = Arc::new(ObjectStore::new(&config.minio));
    let cancel = CancellationToken::new();
    let metrics = Arc::new(observer::Metrics::new().context("initialize observer metrics")?);
    let observer_task =
        observer::start(&config.observer.addr, Arc::clone(&metrics), cancel.clone())
            .await
            .map_err(|error| {
                anyhow::anyhow!(
                    "failed to bind inference observer at {}: {error}",
                    config.observer.addr
                )
            })?;
    let worker_cancel = cancel.clone();
    let worker_config = config.clone();
    let worker_store = store.clone();
    let worker_js = js.clone();
    let worker_metrics = metrics;
    let mut worker_task = tokio::spawn(async move {
        worker::run_pool(
            worker_js,
            worker_store,
            worker_config,
            worker_cancel,
            worker_metrics,
        )
        .await
    });
    let promotion_cancel = cancel.clone();
    let promotion_config = config.clone();
    let promotion_store = store.clone();
    let mut promotion_task = tokio::spawn(async move {
        promotion::run(nats, promotion_store, promotion_config, promotion_cancel).await
    });

    let runtime_result = tokio::select! {
        result = &mut worker_task => {
            cancel.cancel();
            result.context("inference worker task panicked")?
        }
        result = &mut promotion_task => {
            cancel.cancel();
            result.context("promotion canary task panicked")?
        }
        _ = signal::ctrl_c() => {
            tracing::info!("Shutdown signal received, stopping inference runtime...");
            cancel.cancel();
            tokio::time::sleep(Duration::from_millis(100)).await;
            Ok(())
        }
    };

    if !worker_task.is_finished() {
        let _ = worker_task.await;
    }
    if !promotion_task.is_finished() {
        let _ = promotion_task.await;
    }
    runtime_result?;

    if let Err(error) = observer_task.await {
        tracing::warn!(error = %error, "Observer task exited unexpectedly");
    }

    Ok(())
}
