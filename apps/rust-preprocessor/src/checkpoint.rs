use anyhow::{bail, Result};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::event::{BronzeObjectReady, ProductKind};
use crate::infra::MinioClient;
use crate::output::silver::SilverArtifact;

/// Schema version for preprocessing checkpoint format.
pub const CURRENT_CHECKPOINT_SCHEMA_VERSION: u32 = 1;

/// Preprocessing progress state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProcessingState {
    Processing,
    SilverStored,
    Completed,
    Failed,
}

/// Recovery action determined by evaluating checkpoint state against durable storage.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RecoveryAction {
    /// No valid prior success exists — run normal processing.
    Process,
    /// Partial or invalid state — reprocess from Bronze object.
    Reprocess,
    /// Silver object exists on storage — verify and promote checkpoint to COMPLETED.
    VerifySilver,
    /// Silver verified and checkpoint COMPLETED — reuse Silver and ACK JetStream message immediately.
    ReuseAndAck,
}

/// Durable checkpoint record saved in MinIO (`checkpoints/preprocessing/objects/<id>.json`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreprocessingCheckpoint {
    pub schema_version: u32,
    pub checkpoint_id: String,

    pub source_product_id: String,
    pub sample_id: Option<String>,
    pub product_kind: ProductKind,

    pub bronze_bucket: String,
    pub bronze_object_key: String,
    pub bronze_sha256: String,

    pub processor_version: String,

    pub silver_bucket: Option<String>,
    pub silver_object_key: Option<String>,
    pub silver_sha256: Option<String>,
    pub silver_size_bytes: Option<u64>,
    pub silver_schema_version: Option<String>,

    pub state: ProcessingState,

    pub attempts: u32,
    pub last_error: Option<String>,

    pub created_at: String,
    pub updated_at: String,
}

impl PreprocessingCheckpoint {
    /// Create a new checkpoint record in `PROCESSING` state for a fresh event attempt.
    pub fn new(event: &BronzeObjectReady, processor_version: &str) -> Self {
        let checkpoint_id = derive_checkpoint_id(&event.source_product_id, processor_version);
        let now = Utc::now().to_rfc3339();

        Self {
            schema_version: CURRENT_CHECKPOINT_SCHEMA_VERSION,
            checkpoint_id,
            source_product_id: event.source_product_id.clone(),
            sample_id: event.sample_id.clone(),
            product_kind: event.product_kind.clone(),
            bronze_bucket: event.bucket.clone(),
            bronze_object_key: event.object_key.clone(),
            bronze_sha256: event.sha256.clone(),
            processor_version: processor_version.to_string(),
            silver_bucket: None,
            silver_object_key: None,
            silver_sha256: None,
            silver_size_bytes: None,
            silver_schema_version: None,
            state: ProcessingState::Processing,
            attempts: 1,
            last_error: None,
            created_at: now.clone(),
            updated_at: now,
        }
    }

    /// Load a checkpoint from MinIO infrastructure. Returns `Ok(None)` if not found.
    pub async fn load(minio: &MinioClient, bucket: &str, key: &str) -> Result<Option<Self>> {
        let checkpoint: Option<Self> = minio.get_json_object(bucket, key).await?;
        if let Some(ref cp) = checkpoint {
            cp.validate_schema_version()?;
        }
        Ok(checkpoint)
    }

    /// Save checkpoint atomically to MinIO infrastructure.
    pub async fn save(&self, minio: &MinioClient, bucket: &str, key: &str) -> Result<()> {
        minio.put_json_object(bucket, key, self).await?;
        tracing::debug!(
            bucket = bucket,
            object_key = key,
            state = ?self.state,
            operation = "checkpoint_save",
            "Checkpoint saved to MinIO"
        );
        Ok(())
    }

    /// Update checkpoint to `SILVER_STORED` after successful Silver artifact upload.
    pub fn mark_silver_stored(&mut self, artifact: &SilverArtifact) {
        self.silver_bucket = Some(artifact.bucket.clone());
        self.silver_object_key = Some(artifact.object_key.clone());
        self.silver_sha256 = Some(artifact.sha256.clone());
        self.silver_size_bytes = Some(artifact.size_bytes);
        self.silver_schema_version = Some(artifact.schema_version.clone());
        self.state = ProcessingState::SilverStored;
        self.updated_at = Utc::now().to_rfc3339();
    }

    /// Promote checkpoint to `COMPLETED` after Silver durability verification.
    pub fn mark_completed(&mut self) {
        self.state = ProcessingState::Completed;
        self.updated_at = Utc::now().to_rfc3339();
    }

    /// Record processing failure.
    pub fn mark_failed(&mut self, error_msg: &str) {
        self.state = ProcessingState::Failed;
        self.last_error = Some(error_msg.to_string());
        self.updated_at = Utc::now().to_rfc3339();
    }

    /// Validate deserialized checkpoint schema version.
    pub fn validate_schema_version(&self) -> Result<()> {
        if self.schema_version != CURRENT_CHECKPOINT_SCHEMA_VERSION {
            bail!(
                "Unsupported checkpoint schema_version {}: current supported version is {}",
                self.schema_version,
                CURRENT_CHECKPOINT_SCHEMA_VERSION
            );
        }
        Ok(())
    }
}

/// Derive a deterministic checkpoint ID from source product ID and processor version.
pub fn derive_checkpoint_id(source_product_id: &str, processor_version: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(source_product_id.as_bytes());
    hasher.update(b":");
    hasher.update(processor_version.as_bytes());
    hex::encode(hasher.finalize())
}

/// Build the MinIO object key for storing a checkpoint.
///
/// Format: `checkpoints/preprocessing/objects/<checkpoint_id>.json`
pub fn build_checkpoint_object_key(checkpoint_id: &str) -> String {
    format!("checkpoints/preprocessing/objects/{checkpoint_id}.json")
}
