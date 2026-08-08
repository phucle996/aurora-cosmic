use anyhow::Result;
use tracing;

use crate::checkpoint::{
    build_checkpoint_object_key, derive_checkpoint_id, PreprocessingCheckpoint, ProcessingState,
    RecoveryAction,
};
use crate::event::BronzeObjectReady;
use crate::infra::MinioClient;

/// Evaluate recovery action for a Bronze message against durable MinIO checkpoints.
pub async fn evaluate_recovery(
    minio: &MinioClient,
    event: &BronzeObjectReady,
    processor_version: &str,
) -> Result<(RecoveryAction, Option<PreprocessingCheckpoint>)> {
    let checkpoint_id = derive_checkpoint_id(&event.source_product_id, processor_version);
    let checkpoint_key = build_checkpoint_object_key(&checkpoint_id);

    let checkpoint =
        match PreprocessingCheckpoint::load(minio, &event.bucket, &checkpoint_key).await? {
            Some(cp) => cp,
            None => return Ok((RecoveryAction::Process, None)),
        };

    // Bronze checksum mismatch check
    if checkpoint.bronze_sha256 != event.sha256 {
        tracing::warn!(
            checkpoint_id = %checkpoint_id,
            checkpoint_sha = %checkpoint.bronze_sha256,
            event_sha = %event.sha256,
            "Bronze SHA-256 mismatch in checkpoint — forcing reprocessing"
        );
        return Ok((RecoveryAction::Reprocess, Some(checkpoint)));
    }

    match checkpoint.state {
        ProcessingState::Completed => {
            if let (Some(ref silver_bucket), Some(ref silver_key)) =
                (&checkpoint.silver_bucket, &checkpoint.silver_object_key)
            {
                if let Ok(stat) = minio.stat_object(silver_bucket, silver_key).await {
                    if Some(stat.size_bytes) == checkpoint.silver_size_bytes {
                        tracing::info!(
                            checkpoint_id = %checkpoint_id,
                            silver_key = %silver_key,
                            operation = "checkpoint_recovery",
                            action = "reuse_silver",
                            "Completed checkpoint verified with durable Silver artifact — fast-reusing"
                        );
                        return Ok((RecoveryAction::ReuseAndAck, Some(checkpoint)));
                    }
                }
            }
            tracing::warn!(
                checkpoint_id = %checkpoint_id,
                "Checkpoint completed but Silver object missing/invalid — reprocessing"
            );
            Ok((RecoveryAction::Reprocess, Some(checkpoint)))
        }

        ProcessingState::SilverStored | ProcessingState::Processing => {
            if let (Some(ref silver_bucket), Some(ref silver_key)) =
                (&checkpoint.silver_bucket, &checkpoint.silver_object_key)
            {
                if let Ok(stat) = minio.stat_object(silver_bucket, silver_key).await {
                    if Some(stat.size_bytes) == checkpoint.silver_size_bytes {
                        tracing::info!(
                            checkpoint_id = %checkpoint_id,
                            silver_key = %silver_key,
                            operation = "checkpoint_recovery",
                            action = "verify_silver",
                            "Durable Silver artifact found for unfinished checkpoint — promoting to COMPLETED"
                        );
                        return Ok((RecoveryAction::VerifySilver, Some(checkpoint)));
                    }
                }
            }
            tracing::info!(
                checkpoint_id = %checkpoint_id,
                state = ?checkpoint.state,
                "Unfinished checkpoint without verified Silver artifact — reprocessing"
            );
            Ok((RecoveryAction::Reprocess, Some(checkpoint)))
        }

        ProcessingState::Failed => {
            tracing::info!(
                checkpoint_id = %checkpoint_id,
                attempts = checkpoint.attempts,
                "Prior checkpoint failed — reprocessing"
            );
            Ok((RecoveryAction::Reprocess, Some(checkpoint)))
        }
    }
}
