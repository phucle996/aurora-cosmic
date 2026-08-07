use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use async_nats::jetstream::{self, consumer::pull::Config as PullConfig, AckKind};
use chrono::Utc;
use tokio::sync::Semaphore;
use tokio::task::JoinSet;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::config::{ConsumerConfig, ImageConfig, LightCurveConfig};
use crate::event::{BronzeObjectReady, ProductKind, SilverObjectReady};
use crate::fits::{self, DecodedProduct};
use crate::output::silver::{self, SilverArtifact};
use crate::pipeline;
use crate::storage::StorageClient;

/// Subjects to subscribe from AURORA_BRONZE stream.
const BRONZE_FILTER_SUBJECT: &str = "aurora.v1.bronze.*.ready";

/// Run the Tokio Parallel Worker Pool.
pub async fn run_pool(
    jetstream: jetstream::Context,
    storage: Arc<StorageClient>,
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

                    let storage_ref = storage.clone();
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
                            storage_ref,
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

/// Process a single Data Object through the end-to-end 5-step flow:
/// 1. Ingest: Verify MinIO Bronze stat & stream download with SHA-256 check
/// 2. Decode: Parse FITS binary (CFITSIO)
/// 3. Preprocess: Scientific quality filter & median normalization
/// 4. Serialize: Arrow RecordBatch & Parquet ZSTD writer
/// 5. Sink: MinIO Silver upload, verify size, publish NATS Silver event, & ACK Bronze message
pub(crate) async fn process_message(
    msg: jetstream::Message,
    storage: Arc<StorageClient>,
    jetstream: jetstream::Context,
    tmp_dir: PathBuf,
    lc_cfg: LightCurveConfig,
    img_cfg: ImageConfig,
    _permit: Option<tokio::sync::OwnedSemaphorePermit>,
) {
    let subject = msg.subject.clone();

    // Decode Bronze event payload
    let event = match serde_json::from_slice::<BronzeObjectReady>(&msg.payload) {
        Ok(e) => e,
        Err(decode_err) => {
            tracing::warn!(
                subject = %subject,
                error = %decode_err,
                "Failed to decode bronze event JSON — terminating poison message"
            );
            if let Err(e) = msg.ack_with(AckKind::Term).await {
                tracing::error!(error = %e, "Failed to TERM malformed message");
            }
            return;
        }
    };

    let event_id = event.event_id.clone();

    tracing::info!(
        event_id = %event_id,
        product_kind = ?event.product_kind,
        bucket = %event.bucket,
        object_key = %event.object_key,
        "Worker processing Data Object"
    );

    match execute_item_pipeline(&storage, &event, &tmp_dir, &lc_cfg, &img_cfg).await {
        Ok(artifact) => {
            // Upload to MinIO Silver
            if let Err(e) = storage
                .put_file_and_verify(
                    &artifact.bucket,
                    &artifact.object_key,
                    &artifact.local_path,
                    artifact.size_bytes,
                    artifact.metadata.clone(),
                )
                .await
            {
                tracing::warn!(event_id = %event_id, error = %e, "Silver MinIO upload failed — NAKing");
                let _ = msg.ack_with(AckKind::Nak(None)).await;
                return;
            }

            // Publish Silver ready event to NATS
            let silver_event = SilverObjectReady {
                event_id: Uuid::new_v4().to_string(),
                event_type: "silver.object.ready".to_string(),
                source_event_id: event.event_id.clone(),
                source_product_id: event.source_product_id.clone(),
                sample_id: event.sample_id.clone(),
                bucket: artifact.bucket.clone(),
                object_key: artifact.object_key.clone(),
                product_kind: event.product_kind.clone(),
                schema_version: artifact.schema_version.clone(),
                processor_version: artifact.processor_version.clone(),
                sector: event.sector,
                tic_id: event.tic_id,
                camera: event.camera,
                ccd: event.ccd,
                size_bytes: artifact.size_bytes,
                sha256: artifact.sha256.clone(),
                occurred_at: Utc::now().to_rfc3339(),
            };

            if let Err(e) = publish_silver_event(&jetstream, &silver_event).await {
                tracing::warn!(event_id = %event_id, error = %e, "Failed to publish Silver event");
            }

            // Final ACK
            if let Err(e) = msg.ack().await {
                tracing::error!(event_id = %event_id, error = %e, "Failed to ACK message");
            } else {
                tracing::info!(
                    event_id = %event_id,
                    silver_key = %artifact.object_key,
                    "Data Object processed and durably stored in Silver"
                );
            }
        }
        Err(err) => {
            tracing::warn!(
                event_id = %event_id,
                error = %err,
                "Processing failed — NAKing message for redelivery"
            );
            let _ = msg.ack_with(AckKind::Nak(None)).await;
        }
    }
}

/// Helper function to perform Steps 1..4 (Ingest, Decode, Preprocess, Serialize).
pub(crate) async fn execute_item_pipeline(
    storage: &StorageClient,
    event: &BronzeObjectReady,
    tmp_dir: &PathBuf,
    lc_cfg: &LightCurveConfig,
    img_cfg: &ImageConfig,
) -> Result<SilverArtifact> {
    // Step 1: Ingest (Stat & Fetch)
    storage
        .stat_and_verify_size(&event.bucket, &event.object_key, event.size_bytes)
        .await?;

    let temp_fits_file = storage
        .fetch_to_temp(
            &event.bucket,
            &event.object_key,
            event.size_bytes,
            &event.sha256,
            tmp_dir,
        )
        .await?;

    // Steps 2, 3, 4: CPU-bound Decode -> Preprocess -> Parquet Serialization
    let event_clone = event.clone();
    let temp_fits_path = temp_fits_file.path.clone();
    let tmp_dir_clone = tmp_dir.clone();
    let lc_config = lc_cfg.clone();
    let img_config = img_cfg.clone();

    let artifact = tokio::task::spawn_blocking(move || -> Result<SilverArtifact> {
        let decoded = fits::decode(&temp_fits_path, &event_clone)?;
        match decoded {
            DecodedProduct::LightCurve(raw_lc) => {
                let processed = pipeline::lightcurve::preprocess_lc(raw_lc, &event_clone, &lc_config)?;
                silver::serialize_lightcurve(&processed, &event_clone, &tmp_dir_clone)
            }
            DecodedProduct::TargetPixel(raw_tpf) => {
                let processed = pipeline::image::preprocess_target_pixel(raw_tpf, &event_clone, &img_config)?;
                silver::serialize_target_pixel(&processed, &event_clone, &tmp_dir_clone)
            }
            DecodedProduct::Ffi(raw_ffi) => {
                let processed = pipeline::image::preprocess_ffi(raw_ffi, &event_clone, &img_config, None)?;
                silver::serialize_ffi(&processed, &event_clone, &tmp_dir_clone)
            }
        }
    })
    .await
    .context("CPU task panicked")??;

    Ok(artifact)
}

/// Publish SilverObjectReady event to NATS JetStream.
pub(crate) async fn publish_silver_event(jetstream: &jetstream::Context, event: &SilverObjectReady) -> Result<()> {
    let subject = match event.product_kind {
        ProductKind::LightCurve => "aurora.v1.silver.lightcurve.ready",
        ProductKind::TargetPixel => "aurora.v1.silver.target_pixel.ready",
        ProductKind::Ffi => "aurora.v1.silver.ffi.ready",
    };

    let payload = serde_json::to_vec(event)?;
    jetstream
        .publish(subject.to_string(), payload.into())
        .await?
        .await?;

    Ok(())
}

pub(crate) fn parse_duration(s: &str) -> Duration {
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
