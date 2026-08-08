use anyhow::{bail, Context, Result};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::checkpoint::PreprocessingCheckpoint;
use crate::event::{BronzeObjectReady, ProductKind};
use crate::failure::{ErrorKind, ProcessingFailure};
use crate::infra::MinioClient;
use crate::output::silver::SilverArtifact;

/// V1 lineage schema version.
pub const CURRENT_LINEAGE_SCHEMA_VERSION: u32 = 1;

/// V1 Bronze eviction policy identifier.
pub const EVICTION_POLICY_V1: &str = "bronze-eviction-v1";

// ---------------------------------------------------------------------------
// Lineage Status
// ---------------------------------------------------------------------------

/// Lifecycle status of a lineage record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LineageStatus {
    /// Source → Bronze → Processor → Silver relationship durably persisted.
    LineageCommitted,
}

// ---------------------------------------------------------------------------
// Eviction Eligibility
// ---------------------------------------------------------------------------

/// Result of evaluating whether the Bronze source object may be deleted.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvictionEligibility {
    /// Policy version used to evaluate eligibility.
    pub policy_version: String,
    /// Whether the Bronze object is eligible for deletion.
    pub eligible: bool,
    /// Machine-readable reason code.
    pub reason: String,
}

impl EvictionEligibility {
    pub fn eligible() -> Self {
        Self {
            policy_version: EVICTION_POLICY_V1.to_string(),
            eligible: true,
            reason: "SUCCESSFUL_SILVER_DURABLE".to_string(),
        }
    }

    pub fn blocked(reason: &str) -> Self {
        Self {
            policy_version: EVICTION_POLICY_V1.to_string(),
            eligible: false,
            reason: reason.to_string(),
        }
    }
}

// ---------------------------------------------------------------------------
// Sub-record types
// ---------------------------------------------------------------------------

/// Source retrieval lineage — survives even after Bronze is deleted.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceLineage {
    pub provider: String,
    pub mission: String,
    pub source_product_id: String,
    /// Original source retrieval URI. Required for eviction eligibility.
    pub source_uri: Option<String>,
    /// Source version if provided by the upstream system.
    pub source_version: Option<String>,
}

/// Bronze object identity lineage.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BronzeLineage {
    pub bucket: String,
    pub object_key: String,
    pub size_bytes: u64,
    pub sha256: String,
    pub product_kind: ProductKind,
    pub sector: u32,
    pub tic_id: Option<u64>,
    pub camera: Option<u8>,
    pub ccd: Option<u8>,
}

/// Processing provenance — which algorithm transformed the Bronze.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessingLineage {
    pub service: String,
    pub processor_version: String,
    pub product_kind: ProductKind,
    /// Snapshot of output-affecting scientific configuration parameters.
    pub processing_parameters: serde_json::Value,
    /// SHA-256 fingerprint of canonical scientific config (excludes operational settings).
    pub processing_fingerprint: String,
}

/// Silver artifact lineage.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SilverLineage {
    pub bucket: String,
    pub object_key: String,
    pub size_bytes: u64,
    pub sha256: String,
    pub schema_version: String,
    pub processor_version: String,
}

// ---------------------------------------------------------------------------
// LineageRecord
// ---------------------------------------------------------------------------

/// Durable permanent provenance record for one processed AURORA product.
///
/// Stored at: `lineage/v1/tess/{product_kind}/{lineage_id}.json`
///
/// This record is NOT a checkpoint. It is permanent data provenance.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LineageRecord {
    pub schema_version: u32,
    pub lineage_id: String,
    pub status: LineageStatus,

    pub source: SourceLineage,
    pub bronze: BronzeLineage,
    pub processing: ProcessingLineage,
    pub silver: SilverLineage,

    pub eviction: EvictionEligibility,

    /// Optional back-reference for diagnostics — not a hard dependency.
    pub preprocessing_checkpoint_id: Option<String>,

    /// RFC-3339 timestamp of first commit. Preserved on idempotent re-runs.
    pub committed_at: String,
}

impl LineageRecord {
    /// Load an existing lineage record from MinIO. Returns `Ok(None)` if not found.
    pub async fn load(minio: &MinioClient, bucket: &str, key: &str) -> Result<Option<Self>> {
        let record: Option<Self> = minio.get_json_object(bucket, key).await?;
        if let Some(ref r) = record {
            r.validate_schema_version()?;
        }
        Ok(record)
    }

    /// Commit lineage to MinIO idempotently.
    ///
    /// - If no existing record: PUT and return.
    /// - If existing record matches logically: reuse (preserve `committed_at`).
    /// - If existing record conflicts: return `ProcessingFailure::conflict`.
    pub async fn commit(
        minio: &MinioClient,
        bucket: &str,
        key: &str,
        candidate: &LineageRecord,
    ) -> Result<LineageOutcome, ProcessingFailure> {
        match LineageRecord::load(minio, bucket, key).await {
            Err(e) => Err(ProcessingFailure::retryable(
                ErrorKind::InternalTemporary,
                format!("Failed to load existing lineage for conflict check: {e}"),
            )),
            Ok(Some(existing)) => {
                // Conflict check — critical fields must match
                if existing.bronze.sha256 != candidate.bronze.sha256 {
                    return Err(ProcessingFailure::conflict(
                        ErrorKind::SilverConflict,
                        format!(
                            "Lineage conflict: existing bronze_sha={} vs candidate={}",
                            existing.bronze.sha256, candidate.bronze.sha256
                        ),
                    ));
                }
                if existing.silver.sha256 != candidate.silver.sha256 {
                    return Err(ProcessingFailure::conflict(
                        ErrorKind::SilverConflict,
                        format!(
                            "Lineage conflict: existing silver_sha={} vs candidate={}",
                            existing.silver.sha256, candidate.silver.sha256
                        ),
                    ));
                }
                if existing.silver.object_key != candidate.silver.object_key {
                    return Err(ProcessingFailure::conflict(
                        ErrorKind::SilverConflict,
                        format!(
                            "Lineage conflict: existing silver_key={} vs candidate={}",
                            existing.silver.object_key, candidate.silver.object_key
                        ),
                    ));
                }
                if existing.source.source_product_id != candidate.source.source_product_id {
                    return Err(ProcessingFailure::conflict(
                        ErrorKind::SilverConflict,
                        format!(
                            "Lineage conflict: existing source_product_id={} vs candidate={}",
                            existing.source.source_product_id, candidate.source.source_product_id
                        ),
                    ));
                }
                // Logically identical — reuse
                Ok(LineageOutcome::Reused(existing))
            }
            Ok(None) => {
                // First commit
                minio.put_json_object(bucket, key, candidate).await
                    .map_err(|e| ProcessingFailure::retryable(
                        ErrorKind::InternalTemporary,
                        format!("Failed to PUT lineage record: {e}"),
                    ))?;
                Ok(LineageOutcome::Committed)
            }
        }
    }

    /// Validate schema version on load.
    pub fn validate_schema_version(&self) -> Result<()> {
        if self.schema_version != CURRENT_LINEAGE_SCHEMA_VERSION {
            bail!(
                "Unsupported lineage schema_version {}: supported={}",
                self.schema_version,
                CURRENT_LINEAGE_SCHEMA_VERSION
            );
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Outcome of a commit attempt
// ---------------------------------------------------------------------------

/// Result of a lineage commit operation.
pub enum LineageOutcome {
    /// Record was newly created.
    Committed,
    /// Existing identical record was reused.
    Reused(LineageRecord),
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/// Build a complete LineageRecord from verified processing artifacts.
///
/// Reads Bronze metadata from MinIO to extract `source_uri` and `source_version`.
pub async fn build_lineage_record(
    minio: &MinioClient,
    event: &BronzeObjectReady,
    checkpoint: &PreprocessingCheckpoint,
    artifact: &SilverArtifact,
    processing_params: serde_json::Value,
) -> Result<LineageRecord> {
    // Read Bronze object metadata to extract source_uri and source_version
    let bronze_stat = minio
        .stat_object(&event.bucket, &event.object_key)
        .await
        .with_context(|| {
            format!(
                "Failed to stat Bronze object for lineage: {}/{}",
                event.bucket, event.object_key
            )
        })?;

    // Extract source URI from Bronze MinIO object metadata (written by Stage 2 ingester)
    // Rust treats this as opaque lineage metadata — it does not query MAST directly.
    let source_uri = bronze_stat.metadata_value("source-uri");
    let source_version = bronze_stat.metadata_value("source-version");

    let lineage_id = derive_lineage_id(&event.source_product_id, &artifact.processor_version);
    let processing_fingerprint = derive_processing_fingerprint(
        &artifact.processor_version,
        &processing_params,
    );

    let eviction = evaluate_eviction_eligibility(
        &source_uri,
        &checkpoint.state,
        &artifact.sha256,
    );

    Ok(LineageRecord {
        schema_version: CURRENT_LINEAGE_SCHEMA_VERSION,
        lineage_id,
        status: LineageStatus::LineageCommitted,
        source: SourceLineage {
            provider: "MAST".to_string(),
            mission: "TESS".to_string(),
            source_product_id: event.source_product_id.clone(),
            source_uri,
            source_version,
        },
        bronze: BronzeLineage {
            bucket: event.bucket.clone(),
            object_key: event.object_key.clone(),
            size_bytes: event.size_bytes,
            sha256: event.sha256.clone(),
            product_kind: event.product_kind.clone(),
            sector: event.sector,
            tic_id: event.tic_id,
            camera: event.camera,
            ccd: event.ccd,
        },
        processing: ProcessingLineage {
            service: "rust-preprocessor".to_string(),
            processor_version: artifact.processor_version.clone(),
            product_kind: event.product_kind.clone(),
            processing_parameters: processing_params,
            processing_fingerprint,
        },
        silver: SilverLineage {
            bucket: artifact.bucket.clone(),
            object_key: artifact.object_key.clone(),
            size_bytes: artifact.size_bytes,
            sha256: artifact.sha256.clone(),
            schema_version: artifact.schema_version.clone(),
            processor_version: artifact.processor_version.clone(),
        },
        eviction,
        preprocessing_checkpoint_id: Some(checkpoint.checkpoint_id.clone()),
        committed_at: Utc::now().to_rfc3339(),
    })
}

// ---------------------------------------------------------------------------
// Eligibility evaluation
// ---------------------------------------------------------------------------

/// Evaluate Bronze eviction eligibility under policy `bronze-eviction-v1`.
pub fn evaluate_eviction_eligibility(
    source_uri: &Option<String>,
    checkpoint_state: &crate::checkpoint::ProcessingState,
    silver_sha256: &str,
) -> EvictionEligibility {
    use crate::checkpoint::ProcessingState;

    if source_uri.is_none() {
        return EvictionEligibility::blocked("SOURCE_URI_MISSING");
    }

    match checkpoint_state {
        ProcessingState::Completed => {}
        ProcessingState::Processing | ProcessingState::SilverStored => {
            return EvictionEligibility::blocked("CHECKPOINT_NOT_COMPLETED");
        }
        ProcessingState::Failed => {
            return EvictionEligibility::blocked("PROCESSING_REJECTED");
        }
    }

    if silver_sha256.is_empty() {
        return EvictionEligibility::blocked("SILVER_MISSING");
    }

    EvictionEligibility::eligible()
}

// ---------------------------------------------------------------------------
// Key derivation
// ---------------------------------------------------------------------------

/// Derive a deterministic lineage ID from source_product_id and processor_version.
///
/// `SHA256(source_product_id + ":" + processor_version)`
pub fn derive_lineage_id(source_product_id: &str, processor_version: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(source_product_id.as_bytes());
    hasher.update(b":");
    hasher.update(processor_version.as_bytes());
    hex::encode(hasher.finalize())
}

/// Derive a processing fingerprint from canonical scientific config.
///
/// Excludes operational-only settings (workers, NATS URL, tmp dir).
pub fn derive_processing_fingerprint(
    processor_version: &str,
    processing_params: &serde_json::Value,
) -> String {
    let canonical = format!(
        "{}:{}",
        processor_version,
        processing_params.to_string()
    );
    let mut hasher = Sha256::new();
    hasher.update(canonical.as_bytes());
    hex::encode(hasher.finalize())
}

/// Build the MinIO object key for a lineage record.
///
/// Format: `lineage/v1/tess/{product_kind}/{lineage_id}.json`
pub fn build_lineage_object_key(product_kind: &ProductKind, lineage_id: &str) -> String {
    let kind_path = match product_kind {
        ProductKind::LightCurve => "lightcurve",
        ProductKind::TargetPixel => "target-pixel",
        ProductKind::Ffi => "ffi",
    };
    format!("lineage/v1/tess/{kind_path}/{lineage_id}.json")
}
