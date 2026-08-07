pub mod pipeline;
pub mod pool;
pub mod publisher;
pub mod recovery;

use std::path::PathBuf;
use std::sync::Arc;

use async_nats::jetstream::{self, AckKind};
use chrono::Utc;

pub use pipeline::execute_item_pipeline;
pub use pool::{parse_duration, run_pool};
pub use publisher::{build_silver_event, publish_silver_event};
pub use recovery::evaluate_recovery;

use crate::checkpoint::{build_checkpoint_object_key, PreprocessingCheckpoint, ProcessingState, RecoveryAction};
use crate::config::{ImageConfig, LightCurveConfig};
use crate::event::{BronzeObjectReady, ProductKind};
use crate::infra::MinioClient;

/// Process a single Data Object through the end-to-end 5-step flow with durable checkpointing:
/// 1. Recovery Check: Load MinIO checkpoint & decide recovery action
/// 2. Ingest: Verify MinIO Bronze stat & stream download with SHA-256 check
/// 3. Decode: Parse FITS binary (CFITSIO)
/// 4. Preprocess: Scientific quality filter & median normalization
/// 5. Serialize: Arrow RecordBatch & Parquet ZSTD writer
/// 6. Sink: Upload Silver, save COMPLETED checkpoint, publish NATS Silver event, & ACK message
pub async fn process_message(
    msg: jetstream::Message,
    minio: Arc<MinioClient>,
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
    let processor_version = match event.product_kind {
        ProductKind::LightCurve => "lc-preprocess-v1",
        ProductKind::TargetPixel => "tpf-preprocess-v1",
        ProductKind::Ffi => "ffi-preprocess-v1",
    };

    // 1. Recovery Check via Durable Checkpoint
    let (recovery_action, mut checkpoint_opt) =
        match evaluate_recovery(&minio, &event, processor_version).await {
            Ok(res) => res,
            Err(e) => {
                tracing::warn!(
                    event_id = %event_id,
                    error = %e,
                    "Failed to evaluate checkpoint recovery — falling back to standard processing"
                );
                (RecoveryAction::Process, None)
            }
        };

    // Fast-path 1: Reuse existing verified Silver object & ACK immediately
    if recovery_action == RecoveryAction::ReuseAndAck {
        if let Some(ref cp) = checkpoint_opt {
            if let (Some(ref s_bucket), Some(ref s_key), Some(ref s_sha), Some(s_size)) = (
                &cp.silver_bucket,
                &cp.silver_object_key,
                &cp.silver_sha256,
                cp.silver_size_bytes,
            ) {
                let silver_event = build_silver_event(
                    &event,
                    s_bucket,
                    s_key,
                    s_sha,
                    s_size,
                    cp.silver_schema_version.as_deref().unwrap_or("v1"),
                    processor_version,
                );
                if let Err(e) = publish_silver_event(&jetstream, &silver_event).await {
                    tracing::warn!(event_id = %event_id, error = %e, "Failed to publish Silver event during fast-recovery");
                }
                if let Err(e) = msg.ack().await {
                    tracing::error!(event_id = %event_id, error = %e, "Failed to ACK message during fast-recovery");
                } else {
                    tracing::info!(
                        event_id = %event_id,
                        silver_key = %s_key,
                        operation = "fast_recovery",
                        "Data Object recovery succeeded — Silver reused and message ACKed"
                    );
                }
                return;
            }
        }
    }

    // Fast-path 2: Silver artifact found, promote checkpoint to COMPLETED & ACK
    if recovery_action == RecoveryAction::VerifySilver {
        if let Some(ref mut cp) = checkpoint_opt {
            cp.mark_completed();
            let checkpoint_key = build_checkpoint_object_key(&cp.checkpoint_id);
            if let Err(e) = cp.save(&minio, &cp.bronze_bucket, &checkpoint_key).await {
                tracing::warn!(event_id = %event_id, error = %e, "Failed saving promoted COMPLETED checkpoint");
            }
            if let (Some(ref s_bucket), Some(ref s_key), Some(ref s_sha), Some(s_size)) = (
                &cp.silver_bucket,
                &cp.silver_object_key,
                &cp.silver_sha256,
                cp.silver_size_bytes,
            ) {
                let silver_event = build_silver_event(
                    &event,
                    s_bucket,
                    s_key,
                    s_sha,
                    s_size,
                    cp.silver_schema_version.as_deref().unwrap_or("v1"),
                    processor_version,
                );
                let _ = publish_silver_event(&jetstream, &silver_event).await;
                if let Err(e) = msg.ack().await {
                    tracing::error!(event_id = %event_id, error = %e, "Failed to ACK message during promoted recovery");
                }
                return;
            }
        }
    }

    // Standard Processing Path: Initialize/Update PROCESSING Checkpoint
    let mut checkpoint = match checkpoint_opt {
        Some(mut cp) => {
            cp.attempts += 1;
            cp.state = ProcessingState::Processing;
            cp.updated_at = Utc::now().to_rfc3339();
            cp
        }
        None => PreprocessingCheckpoint::new(&event, processor_version),
    };

    let checkpoint_key = build_checkpoint_object_key(&checkpoint.checkpoint_id);
    if let Err(e) = checkpoint.save(&minio, &event.bucket, &checkpoint_key).await {
        tracing::warn!(event_id = %event_id, error = %e, "Failed to save initial PROCESSING checkpoint");
    }

    tracing::info!(
        event_id = %event_id,
        checkpoint_id = %checkpoint.checkpoint_id,
        product_kind = ?event.product_kind,
        bucket = %event.bucket,
        object_key = %event.object_key,
        "Worker processing Data Object"
    );

    match execute_item_pipeline(&minio, &event, &tmp_dir, &lc_cfg, &img_cfg).await {
        Ok(artifact) => {
            // Upload to MinIO Silver
            if let Err(e) = minio
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
                checkpoint.mark_failed(&format!("Silver upload failed: {e}"));
                let _ = checkpoint.save(&minio, &event.bucket, &checkpoint_key).await;
                let _ = msg.ack_with(AckKind::Nak(None)).await;
                return;
            }

            // Update Checkpoint: SILVER_STORED -> COMPLETED
            checkpoint.mark_silver_stored(&artifact);
            checkpoint.mark_completed();
            if let Err(e) = checkpoint.save(&minio, &event.bucket, &checkpoint_key).await {
                tracing::warn!(event_id = %event_id, error = %e, "Failed to save COMPLETED checkpoint");
            }

            // Publish Silver ready event to NATS
            let silver_event = build_silver_event(
                &event,
                &artifact.bucket,
                &artifact.object_key,
                &artifact.sha256,
                artifact.size_bytes,
                &artifact.schema_version,
                processor_version,
            );

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
                    checkpoint_id = %checkpoint.checkpoint_id,
                    "Data Object processed and durably stored in Silver with checkpoint COMPLETED"
                );
            }
        }
        Err(err) => {
            tracing::warn!(
                event_id = %event_id,
                error = %err,
                "Processing failed — recording FAILED checkpoint and NAKing message"
            );
            checkpoint.mark_failed(&err.to_string());
            let _ = checkpoint.save(&minio, &event.bucket, &checkpoint_key).await;
            let _ = msg.ack_with(AckKind::Nak(None)).await;
        }
    }
}
