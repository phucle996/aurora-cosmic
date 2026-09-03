use std::path::Path;
use std::sync::Arc;

use anyhow::{Context, Result};
use async_nats::{Client, Message};
use chrono::Utc;
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use tempfile::TempDir;
use tokio_util::sync::CancellationToken;

use crate::adapters::storage::ObjectStore;
use crate::config::Config;
use crate::runtime::{compute_sha256, validate_runtime_package_parity_with_device};

const PROMOTION_REQUEST_SUBJECT: &str = "aurora.live.ml.promotion.requested";
const PROMOTION_PROGRESS_SUBJECT: &str = "aurora.live.ml.promotion.progress";

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct PromotionCanaryRequest {
    schema_version: i64,
    ticket_id: String,
    runtime_package_id: String,
    runtime_manifest_key: String,
    runtime_manifest_sha256: String,
    task: String,
    requested_at: String,
}

#[derive(Debug, Serialize)]
struct PromotionCanaryResponse {
    schema_version: i64,
    ticket_id: String,
    runtime_package_id: String,
    status: String,
    runtime_validation_id: Option<String>,
    engine: Option<String>,
    max_absolute_error: Option<f64>,
    max_relative_error: Option<f64>,
    parity_cases: usize,
    error: Option<String>,
    occurred_at: String,
}

#[derive(Debug, Serialize)]
struct PromotionProgress<'a> {
    schema_version: i64,
    event_type: &'static str,
    ticket_id: &'a str,
    runtime_package_id: &'a str,
    task: &'a str,
    status: &'a str,
    phase: &'a str,
    progress_percent: i64,
    message: &'a str,
    parity_cases: usize,
    occurred_at: String,
}

pub async fn run(
    client: Client,
    store: Arc<ObjectStore>,
    config: Config,
    cancel: CancellationToken,
) -> Result<()> {
    let mut subscription = client
        .subscribe(PROMOTION_REQUEST_SUBJECT)
        .await
        .context("subscribe promotion canary requests")?;
    tracing::info!(
        subject = PROMOTION_REQUEST_SUBJECT,
        "Promotion canary subscriber ready"
    );

    loop {
        let message = tokio::select! {
            _ = cancel.cancelled() => break,
            message = subscription.next() => message,
        };
        let Some(message) = message else { break };
        let request_client = client.clone();
        let request_store = store.clone();
        let request_config = config.clone();
        tokio::spawn(async move {
            if let Err(error) =
                handle_message(request_client, request_store, request_config, message).await
            {
                tracing::error!(%error, "promotion canary request failed");
            }
        });
    }
    Ok(())
}

async fn handle_message(
    client: Client,
    store: Arc<ObjectStore>,
    config: Config,
    message: Message,
) -> Result<()> {
    let reply = message.reply.clone();
    let request: PromotionCanaryRequest = match serde_json::from_slice(&message.payload) {
        Ok(request) => request,
        Err(error) => {
            if let Some(reply) = reply {
                let response = serde_json::json!({"schema_version": 1, "status": "FAIL", "error": format!("invalid promotion canary request: {error}")});
                client
                    .publish(reply, serde_json::to_vec(&response)?.into())
                    .await?;
            }
            return Ok(());
        }
    };
    let validation =
        validate_request(&request).and_then(|_| runtime_parent(&request.runtime_manifest_key));
    let runtime_dir = match validation {
        Ok(value) => value,
        Err(error) => return respond_failure(&client, reply, &request, error.to_string()).await,
    };

    publish_progress(
        &client,
        &request,
        "runtime_package_download",
        45,
        "Downloading immutable ONNX runtime package",
        0,
    )
    .await?;
    let package = match download_runtime_package(&store, &config.minio.bucket, &runtime_dir).await {
        Ok(package) => package,
        Err(error) => {
            return respond_failure(
                &client,
                reply,
                &request,
                format!("download runtime package: {error:#}"),
            )
            .await
        }
    };
    let actual_manifest_sha = compute_sha256(&package.path().join("manifest.json"))?;
    if actual_manifest_sha != request.runtime_manifest_sha256 {
        return respond_failure(
            &client,
            reply,
            &request,
            "runtime manifest SHA mismatch".to_string(),
        )
        .await;
    }
    let fixture_bytes = tokio::fs::read(package.path().join("parity-fixture.json")).await?;
    let fixture: serde_json::Value = serde_json::from_slice(&fixture_bytes)?;
    let parity_cases = fixture
        .get("cases")
        .and_then(serde_json::Value::as_array)
        .map_or(0, Vec::len);

    publish_progress(
        &client,
        &request,
        "onnx_session_load",
        60,
        "Loading ONNX session and executing parity canary",
        parity_cases,
    )
    .await?;
    let package_path = package.path().to_path_buf();
    let device = config.ml.device.clone();
    let result = tokio::task::spawn_blocking(move || {
        validate_runtime_package_parity_with_device(&package_path, &device)
    })
    .await
    .context("join promotion parity canary")?;
    let evidence = match result {
        Ok(evidence) => evidence,
        Err(error) => return respond_failure(&client, reply, &request, error.to_string()).await,
    };
    if evidence.validation_status != "PASS"
        || evidence.runtime_package_id != request.runtime_package_id
        || evidence.runtime_manifest_sha256 != request.runtime_manifest_sha256
    {
        return respond_failure(
            &client,
            reply,
            &request,
            "runtime canary evidence does not match request".to_string(),
        )
        .await;
    }

    publish_progress(
        &client,
        &request,
        "parity_canary_passed",
        85,
        "Rust ONNX runtime reproduced the committed parity fixture",
        parity_cases,
    )
    .await?;
    let response = PromotionCanaryResponse {
        schema_version: 1,
        ticket_id: request.ticket_id,
        runtime_package_id: request.runtime_package_id,
        status: "PASS".to_string(),
        runtime_validation_id: Some(evidence.validation_record_id),
        engine: Some(evidence.engine),
        max_absolute_error: Some(evidence.max_absolute_error),
        max_relative_error: Some(evidence.max_relative_error),
        parity_cases,
        error: None,
        occurred_at: Utc::now().to_rfc3339(),
    };
    respond(&client, reply, &response).await
}

fn validate_request(request: &PromotionCanaryRequest) -> Result<()> {
    if request.schema_version != 1
        || request.ticket_id.is_empty()
        || request.runtime_package_id.is_empty()
        || request.task != "candidate_vetting"
        || request.runtime_manifest_sha256.len() != 64
        || request.requested_at.is_empty()
    {
        anyhow::bail!("invalid promotion canary contract")
    }
    Ok(())
}

fn runtime_parent(key: &str) -> Result<String> {
    let parent = Path::new(key)
        .parent()
        .and_then(Path::to_str)
        .context("runtime manifest key has no parent")?;
    if !key.starts_with("models/runtime/")
        || !key.ends_with("/manifest.json")
        || parent.contains("..")
    {
        anyhow::bail!("invalid runtime manifest key")
    }
    Ok(parent.to_string())
}

async fn download_runtime_package(store: &ObjectStore, bucket: &str, dir: &str) -> Result<TempDir> {
    let temp = tempfile::tempdir().context("create promotion runtime directory")?;
    for filename in [
        "manifest.json",
        "model.onnx",
        "preprocessing.json",
        "threshold.json",
        "parity-fixture.json",
    ] {
        let bytes = store.get(bucket, &format!("{dir}/{filename}")).await?;
        tokio::fs::write(temp.path().join(filename), bytes).await?;
    }
    Ok(temp)
}

async fn publish_progress(
    client: &Client,
    request: &PromotionCanaryRequest,
    phase: &str,
    progress_percent: i64,
    message: &str,
    parity_cases: usize,
) -> Result<()> {
    let progress = PromotionProgress {
        schema_version: 1,
        event_type: PROMOTION_PROGRESS_SUBJECT,
        ticket_id: &request.ticket_id,
        runtime_package_id: &request.runtime_package_id,
        task: &request.task,
        status: "running",
        phase,
        progress_percent,
        message,
        parity_cases,
        occurred_at: Utc::now().to_rfc3339(),
    };
    client
        .publish(
            PROMOTION_PROGRESS_SUBJECT,
            serde_json::to_vec(&progress)?.into(),
        )
        .await?;
    client.flush().await?;
    Ok(())
}

async fn respond_failure(
    client: &Client,
    reply: Option<async_nats::Subject>,
    request: &PromotionCanaryRequest,
    error: String,
) -> Result<()> {
    let progress = serde_json::json!({
        "schema_version": 1,
        "event_type": PROMOTION_PROGRESS_SUBJECT,
        "ticket_id": request.ticket_id,
        "runtime_package_id": request.runtime_package_id,
        "task": request.task,
        "status": "failed",
        "phase": "runtime_canary",
        "progress_percent": 100,
        "message": error,
        "error": error,
        "occurred_at": Utc::now().to_rfc3339(),
    });
    client
        .publish(
            PROMOTION_PROGRESS_SUBJECT,
            serde_json::to_vec(&progress)?.into(),
        )
        .await?;
    let response = PromotionCanaryResponse {
        schema_version: 1,
        ticket_id: request.ticket_id.clone(),
        runtime_package_id: request.runtime_package_id.clone(),
        status: "FAIL".to_string(),
        runtime_validation_id: None,
        engine: None,
        max_absolute_error: None,
        max_relative_error: None,
        parity_cases: 0,
        error: Some(error),
        occurred_at: Utc::now().to_rfc3339(),
    };
    respond(client, reply, &response).await
}

async fn respond(
    client: &Client,
    reply: Option<async_nats::Subject>,
    response: &PromotionCanaryResponse,
) -> Result<()> {
    let reply = reply.context("promotion canary request has no reply subject")?;
    client
        .publish(reply, serde_json::to_vec(response)?.into())
        .await?;
    client.flush().await?;
    Ok(())
}
