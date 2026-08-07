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
use crate::failure::{classify_pipeline_error, ErrorKind, FailureClass, ProcessingFailure};
use crate::infra::MinioClient;
use crate::lineage::{
    build_lineage_object_key, build_lineage_record, LineageOutcome, LineageRecord,
};

/// Process a single Data Object through the end-to-end flow:
/// 1. Recovery Check: Load checkpoint — fast-path reuse / terminal guard
/// 2. Ingest: Bronze stat & SHA-256 verified download
/// 3. Decode: FITS binary parse (CFITSIO)
/// 4. Preprocess: Scientific quality filter & median normalization
/// 5. Serialize: Arrow RecordBatch & Parquet ZSTD
/// 6. Silver Sink: Upload Silver to MinIO, update checkpoint to COMPLETED
/// 7. Lineage Commit: Commit durable lineage record and evaluate Bronze eviction eligibility
/// 8. ACK JetStream message
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

    // Read JetStream delivery metadata
    let delivery_attempt = msg.info().map(|info| info.delivered).unwrap_or(1);

    // Decode Bronze event payload — invalid JSON = TERMINAL
    let event = match serde_json::from_slice::<BronzeObjectReady>(&msg.payload) {
        Ok(e) => e,
        Err(decode_err) => {
            tracing::warn!(
                subject = %subject,
                error = %decode_err,
                operation = "preprocess_terminal",
                failure_class = "TERMINAL",
                error_kind = "EVENT_INVALID",
                action = "term",
                "Failed to decode bronze event JSON — terminating poison message"
            );
            let _ = msg.ack_with(AckKind::Term).await;
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

    // Terminal fast-path: prior run declared this product permanently unrecoverable
    if let Some(ref cp) = checkpoint_opt {
        if cp.terminal {
            tracing::info!(
                event_id = %event_id,
                checkpoint_id = %cp.checkpoint_id,
                failure_class = ?cp.last_failure_class,
                error_kind = ?cp.last_error_kind,
                operation = "preprocess_terminal_redelivery",
                "Checkpoint marked terminal — resolving without reprocessing"
            );
            let _ = msg.ack_with(AckKind::Term).await;
            return;
        }
    }

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
            if let Err(e) = cp.save(&minio, &cp.bronze_bucket.clone(), &checkpoint_key).await {
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
        delivery_attempt = delivery_attempt,
        processing_attempt = checkpoint.attempts,
        "Worker processing Data Object"
    );

    // Steps 2-5: Ingest, Decode, Preprocess, Serialize
    let artifact = match execute_item_pipeline(&minio, &event, &tmp_dir, &lc_cfg, &img_cfg).await {
        Ok(a) => a,
        Err(err) => {
            let failure = classify_pipeline_error(&err);
            handle_failure(
                &minio, &mut checkpoint, &event.bucket, &checkpoint_key,
                &msg, failure, event_id.clone(), delivery_attempt,
            ).await;
            return;
        }
    };

    // Step 6: Upload Silver
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
        let failure = ProcessingFailure::retryable(ErrorKind::SilverWriteFailed, e.to_string());
        handle_failure(
            &minio, &mut checkpoint, &event.bucket, &checkpoint_key,
            &msg, failure, event_id.clone(), delivery_attempt,
        ).await;
        return;
    }

    // Update Checkpoint: SILVER_STORED -> COMPLETED
    checkpoint.mark_silver_stored(&artifact);
    checkpoint.mark_completed();
    if let Err(e) = checkpoint.save(&minio, &event.bucket, &checkpoint_key).await {
        tracing::warn!(
            event_id = %event_id,
            error = %e,
            "Failed to save COMPLETED checkpoint — NAKing for safe retry from VerifySilver path"
        );
        let _ = msg.ack_with(AckKind::Nak(None)).await;
        return;
    }

    // Step 7: Lineage Commit & Eviction Eligibility
    let processing_params = build_processing_params(&lc_cfg, &img_cfg, &event.product_kind);
    match build_lineage_record(&minio, &event, &checkpoint, &artifact, processing_params).await {
        Err(e) => {
            // Bronze stat failure while building lineage — treat as retryable
            tracing::warn!(
                event_id = %event_id,
                error = %e,
                operation = "lineage_build_failed",
                "Failed to build lineage record — NAKing (checkpoint COMPLETED, Silver safe)"
            );
            let _ = msg.ack_with(AckKind::Nak(None)).await;
            return;
        }
        Ok(lineage) => {
            let lineage_key = build_lineage_object_key(&event.product_kind, &lineage.lineage_id);

            match LineageRecord::commit(&minio, &event.bucket, &lineage_key, &lineage).await {
                Err(failure) => {
                    // Lineage commit failure — policy determines broker action
                    let is_conflict = failure.class == FailureClass::Conflict;
                    tracing::warn!(
                        event_id = %event_id,
                        lineage_id = %lineage.lineage_id,
                        failure_class = ?failure.class,
                        error_kind = ?failure.kind,
                        error = %failure.message,
                        operation = "lineage_commit_failed",
                        "Lineage commit failed"
                    );
                    if is_conflict {
                        // Lineage conflict: checkpoint is COMPLETED, Silver is safe.
                        // TERM to stop redelivery. Operator must reconcile manually.
                        let _ = msg.ack_with(AckKind::Term).await;
                    } else {
                        // Temporary failure: NAK for retry. Lineage will be retried.
                        // Checkpoint is COMPLETED so recovery picks up from VerifySilver path.
                        let _ = msg.ack_with(AckKind::Nak(None)).await;
                    }
                    return;
                }
                Ok(outcome) => {
                    let (lineage_id, eligible, reason) = match &outcome {
                        LineageOutcome::Committed => (
                            lineage.lineage_id.clone(),
                            lineage.eviction.eligible,
                            lineage.eviction.reason.clone(),
                        ),
                        LineageOutcome::Reused(existing) => (
                            existing.lineage_id.clone(),
                            existing.eviction.eligible,
                            existing.eviction.reason.clone(),
                        ),
                    };

                    let outcome_label = match outcome {
                        LineageOutcome::Committed => "committed",
                        LineageOutcome::Reused(_) => "reused",
                    };

                    tracing::info!(
                        event_id = %event_id,
                        lineage_id = %lineage_id,
                        lineage_key = %lineage_key,
                        outcome = outcome_label,
                        bronze_eviction_eligible = eligible,
                        bronze_eviction_reason = %reason,
                        operation = "lineage_committed",
                        "Lineage record committed to MinIO"
                    );
                }
            }
        }
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

    // Step 8: Final ACK
    if let Err(e) = msg.ack().await {
        tracing::error!(
            event_id = %event_id,
            error = %e,
            operation = "ack_failure",
            "ACK failed — checkpoint COMPLETED and lineage committed, NATS will redeliver for re-ACK"
        );
    } else {
        tracing::info!(
            event_id = %event_id,
            silver_key = %artifact.object_key,
            checkpoint_id = %checkpoint.checkpoint_id,
            "Data Object processed — Silver stored, lineage committed, message ACKed"
        );
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Serialize scientific processing parameters for lineage provenance.
///
/// Only includes output-affecting scientific settings, not operational config.
fn build_processing_params(
    lc_cfg: &LightCurveConfig,
    img_cfg: &ImageConfig,
    product_kind: &ProductKind,
) -> serde_json::Value {
    match product_kind {
        ProductKind::LightCurve => serde_json::json!({
            "min_points": lc_cfg.min_points,
            "quality_mode": lc_cfg.quality_mode,
            "allow_sap_fallback": lc_cfg.allow_sap_fallback,
            "sigma_clip": lc_cfg.sigma_clip,
        }),
        ProductKind::TargetPixel => serde_json::json!({
            "tpf_quality_mode": img_cfg.tpf_quality_mode,
            "tpf_normalization": img_cfg.tpf_normalization,
        }),
        ProductKind::Ffi => serde_json::json!({
            "ffi_normalization": img_cfg.ffi_normalization,
            "ffi_cutout_size": img_cfg.ffi_cutout_size,
        }),
    }
}

/// Apply the failure policy for a classified failure:
/// - RETRYABLE  → persist FAILED checkpoint, NAK
/// - TERMINAL   → persist FAILED + terminal checkpoint, TERM
/// - CONFLICT   → persist FAILED + terminal checkpoint, TERM (preserve artifacts)
/// - REJECTED   → persist FAILED + terminal checkpoint, TERM (scientific rejection)
async fn handle_failure(
    minio: &MinioClient,
    checkpoint: &mut PreprocessingCheckpoint,
    bucket: &str,
    checkpoint_key: &str,
    msg: &jetstream::Message,
    failure: ProcessingFailure,
    event_id: String,
    delivery_attempt: i64,
) {
    let is_terminal = failure.class != FailureClass::Retryable;

    tracing::warn!(
        event_id = %event_id,
        failure_class = ?failure.class,
        error_kind = ?failure.kind,
        error = %failure.message,
        delivery_attempt = delivery_attempt,
        processing_attempt = checkpoint.attempts,
        operation = if is_terminal { "preprocess_terminal" } else { "preprocess_retry" },
        "Processing failure classified"
    );

    checkpoint.mark_classified_failure(&failure.message, failure.class.clone(), failure.kind);

    if is_terminal {
        checkpoint.mark_terminal();
        tracing::warn!(
            event_id = %event_id,
            checkpoint_id = %checkpoint.checkpoint_id,
            operation = "preprocess_terminal",
            action = "term",
            "Marking checkpoint terminal — no further science reprocessing"
        );
    }

    // Persist failure record before any broker action
    if let Err(e) = checkpoint.save(minio, bucket, checkpoint_key).await {
        tracing::error!(
            event_id = %event_id,
            error = %e,
            "Failed to persist failure checkpoint — not taking broker action to avoid losing diagnostics"
        );
        let _ = msg.ack_with(AckKind::Nak(None)).await;
        return;
    }

    if is_terminal {
        let _ = msg.ack_with(AckKind::Term).await;
    } else {
        let _ = msg.ack_with(AckKind::Nak(None)).await;
    }
}
