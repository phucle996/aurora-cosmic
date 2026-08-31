use std::sync::Arc;
use std::time::Duration;

use anyhow::{bail, Context, Result};
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use tokio::signal;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

use crate::config::{Config, ConsumerConfig, ImageConfig, LightCurveConfig};
use crate::infra::MinioClient;
use crate::observer::{self, Metrics};
use crate::runtime::RuntimeReporter;
use crate::worker;

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct PreprocessingControlCommand {
    action: String,
    job_id: String,
    #[serde(default = "default_mode")]
    mode: String,
    #[serde(default)]
    worker_count: Option<usize>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct PreprocessingRunCheckpoint {
    schema_version: u32,
    run_id: String,
    status: String,
    mode: String,
    started_at: String,
    updated_at: String,
    worker_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Clone)]
struct RunDependencies {
    bucket: String,
    consumer: ConsumerConfig,
    lightcurve: LightCurveConfig,
    image: ImageConfig,
    jetstream: async_nats::jetstream::Context,
    minio: Arc<MinioClient>,
    metrics: Arc<Metrics>,
    runtime: RuntimeReporter,
}

fn default_mode() -> String {
    "stream".to_string()
}

/// Application entry point.
pub async fn run(config: Config) -> Result<()> {
    let nats_client = async_nats::connect(&config.nats.url)
        .await
        .with_context(|| format!("Failed to connect to NATS at '{}'", config.nats.url))?;
    let jetstream = async_nats::jetstream::new(nats_client.clone());
    ensure_silver_stream(&jetstream).await?;

    let minio = Arc::new(MinioClient::new(&config.minio)?);
    tokio::fs::create_dir_all(&config.consumer.tmp_dir)
        .await
        .with_context(|| {
            format!(
                "Failed to create preprocessing temp directory {}",
                config.consumer.tmp_dir.display()
            )
        })?;

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
    let runtime_cancel = CancellationToken::new();
    let (runtime, runtime_task) =
        crate::runtime::start(nats_client.clone(), runtime_cancel.clone());

    let deps = RunDependencies {
        bucket: config.minio.bucket.clone(),
        consumer: config.consumer.clone(),
        lightcurve: config.lc_pipeline.clone(),
        image: config.image_pipeline.clone(),
        jetstream,
        minio,
        metrics,
        runtime,
    };
    let mut control_subscription = nats_client
        .subscribe(config.control.subject.clone())
        .await
        .with_context(|| format!("Failed to subscribe to {}", config.control.subject))?;
    let mut worker_task = None;
    let mut active_run: Option<(String, CancellationToken)> = None;

    if config.control.autostart {
        let command = PreprocessingControlCommand {
            action: "start".to_string(),
            job_id: format!("preprocess-autostart-{}", uuid::Uuid::new_v4()),
            mode: "stream".to_string(),
            worker_count: Some(deps.consumer.workers),
        };
        let run_cancel = cancel.child_token();
        worker_task = Some(start_run(deps.clone(), command.clone(), run_cancel.clone()).await?);
        active_run = Some((command.job_id, run_cancel));
    }

    let shutdown_timeout = config.consumer.shutdown_timeout_secs;
    let mut sigterm = Box::pin(wait_sigterm());
    loop {
        tokio::select! {
            _ = signal::ctrl_c() => break,
            _ = &mut sigterm => break,
            command = control_subscription.next() => {
                let Some(message) = command else { break; };
                let command = match serde_json::from_slice::<PreprocessingControlCommand>(&message.payload) {
                    Ok(command) => command,
                    Err(error) => {
                        tracing::warn!(error = %error, "Invalid preprocessing control command");
                        continue;
                    }
                };
                if worker_task.as_ref().is_some_and(JoinHandle::is_finished) {
                    worker_task.take();
                    active_run = None;
                }
                match command.action.as_str() {
                    "start" => {
                        if worker_task.is_some() {
                            tracing::warn!(job_id = %command.job_id, "Preprocessing run already active");
                            continue;
                        }
                        let run_cancel = cancel.child_token();
                        match start_run(deps.clone(), command.clone(), run_cancel.clone()).await {
                            Ok(task) => {
                                worker_task = Some(task);
                                active_run = Some((command.job_id, run_cancel));
                            }
                            Err(error) => tracing::warn!(job_id = %command.job_id, error = %error, "Rejected preprocessing start command"),
                        }
                    }
                    "stop" => {
                        let Some((active_job_id, run_cancel)) = active_run.as_ref() else {
                            tracing::warn!(job_id = %command.job_id, "No preprocessing run to stop");
                            continue;
                        };
                        if active_job_id != &command.job_id {
                            tracing::warn!(job_id = %command.job_id, active_job_id, "Ignoring stop for a non-active preprocessing run");
                            continue;
                        }
                        update_run_status(&deps, active_job_id, "DRAINING", None).await?;
                        run_cancel.cancel();
                    }
                    _ => tracing::warn!(action = %command.action, "Unsupported preprocessing control action"),
                }
            }
        }
    }

    cancel.cancel();
    if let Some(task) = worker_task {
        match tokio::time::timeout(Duration::from_secs(shutdown_timeout), task).await {
            Ok(Ok(())) => tracing::info!("Worker pool drained cleanly"),
            Ok(Err(error)) => tracing::error!(error = %error, "Worker task panicked during drain"),
            Err(_) => tracing::warn!(
                timeout_secs = shutdown_timeout,
                "Shutdown drain timeout exceeded"
            ),
        }
    }
    runtime_cancel.cancel();
    let _ = observer_task.await;
    let _ = runtime_task.await;
    Ok(())
}

async fn ensure_silver_stream(jetstream: &async_nats::jetstream::Context) -> Result<()> {
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
    Ok(())
}

async fn start_run(
    deps: RunDependencies,
    command: PreprocessingControlCommand,
    run_cancel: CancellationToken,
) -> Result<JoinHandle<()>> {
    if !matches!(command.mode.as_str(), "stream" | "batch") {
        bail!("mode must be 'stream' or 'batch'");
    }
    let worker_count = command.worker_count.unwrap_or(deps.consumer.workers);
    if worker_count == 0 || worker_count > 64 {
        bail!("worker_count must be between 1 and 64");
    }
    let now = chrono::Utc::now().to_rfc3339();
    let checkpoint = PreprocessingRunCheckpoint {
        schema_version: 2,
        run_id: command.job_id.clone(),
        status: "RUNNING".to_string(),
        mode: command.mode.clone(),
        started_at: now.clone(),
        updated_at: now,
        worker_count,
        error: None,
    };
    deps.minio
        .put_json_object(
            &deps.bucket,
            "checkpoints/preprocessing/current.json",
            &serde_json::json!({"active_run_id": command.job_id}),
        )
        .await?;
    deps.minio
        .put_json_object(
            &deps.bucket,
            &run_checkpoint_key(&checkpoint.run_id),
            &checkpoint,
        )
        .await?;

    Ok(tokio::spawn(async move {
        let mut consumer = deps.consumer.clone();
        consumer.workers = worker_count;
        let result = worker::run_pool(
            deps.jetstream.clone(),
            Arc::clone(&deps.minio),
            &consumer,
            deps.lightcurve.clone(),
            deps.image.clone(),
            run_cancel.clone(),
            Arc::clone(&deps.metrics),
            &command.mode,
            deps.runtime.clone(),
            &command.job_id,
        )
        .await;
        let (status, error) = match result {
            Ok(()) if run_cancel.is_cancelled() => ("STOPPED", None),
            Ok(()) => ("COMPLETED", None),
            Err(error) => ("FAILED", Some(error.to_string())),
        };
        if let Err(error) = update_run_status(&deps, &command.job_id, status, error).await {
            tracing::error!(job_id = %command.job_id, error = %error, "Failed to persist preprocessing run terminal state");
        }
    }))
}

async fn update_run_status(
    deps: &RunDependencies,
    run_id: &str,
    status: &str,
    error: Option<String>,
) -> Result<()> {
    let key = run_checkpoint_key(run_id);
    let Some(mut checkpoint) = deps
        .minio
        .get_json_object::<PreprocessingRunCheckpoint>(&deps.bucket, &key)
        .await?
    else {
        bail!("preprocessing run checkpoint does not exist: {run_id}");
    };
    checkpoint.status = status.to_string();
    checkpoint.error = error;
    checkpoint.updated_at = chrono::Utc::now().to_rfc3339();
    deps.minio
        .put_json_object(&deps.bucket, &key, &checkpoint)
        .await
}

fn run_checkpoint_key(run_id: &str) -> String {
    format!("checkpoints/preprocessing/runs/{run_id}.json")
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
