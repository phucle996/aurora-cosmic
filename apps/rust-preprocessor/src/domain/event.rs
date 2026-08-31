use serde::{Deserialize, Serialize};

/// AURORA FITS product kind — frozen contract from Stage 2.
/// Maps directly to the `product_kind` field in `bronze-object-ready` and `silver-object-ready` events.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProductKind {
    TargetPixel,
    LightCurve,
    Ffi,
}

/// Typed Rust representation of the `bronze-object-ready` event contract.
///
/// Required fields come from `contracts/events/bronze-object-ready.schema.json`.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct BronzeObjectReady {
    /// Unique event emission identifier (UUID/ULID).
    pub event_id: String,

    /// Type discriminator — always "bronze.object.ready".
    pub event_type: String,

    /// Originating MAST product ID.
    pub source_product_id: String,

    /// Logical observation sample identity (optional).
    pub sample_id: Option<String>,

    /// MinIO Bronze bucket name.
    pub bucket: String,

    /// Deterministic MinIO object key.
    pub object_key: String,

    /// AURORA classified product kind.
    pub product_kind: ProductKind,

    /// TESS observing sector number.
    pub sector: u32,

    /// TESS Input Catalog ID (required for TARGET_PIXEL and LIGHT_CURVE).
    pub tic_id: Option<u64>,

    /// TESS camera number (for FFI).
    pub camera: Option<u8>,

    /// TESS CCD number (for FFI).
    pub ccd: Option<u8>,

    /// Verified object size in bytes.
    pub size_bytes: u64,

    /// SHA-256 checksum hex string.
    pub sha256: String,

    /// ISO-8601 timestamp when the object was stored and verified.
    pub occurred_at: String,
}

/// Typed Rust representation of the `silver-object-ready` event contract for downstream consumers (Stage 4).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SilverObjectReady {
    /// Unique event emission identifier.
    pub event_id: String,

    /// Type discriminator — "silver.object.ready".
    pub event_type: String,

    /// Upstream Bronze event ID that triggered this preprocessing flow.
    pub source_event_id: String,

    /// Originating MAST product ID.
    pub source_product_id: String,

    /// Logical observation sample identity (optional).
    pub sample_id: Option<String>,

    /// MinIO Silver bucket name.
    pub bucket: String,

    /// Deterministic MinIO Silver object key.
    pub object_key: String,

    /// AURORA classified product kind.
    pub product_kind: ProductKind,

    /// Schema contract version (e.g., "silver-lightcurve-v1").
    pub schema_version: String,

    /// Algorithm version used for preprocessing.
    pub processor_version: String,

    /// Deterministic fingerprint of the preprocessing configuration.
    pub processing_fingerprint: String,

    /// TESS observing sector number.
    pub sector: u32,

    /// TESS Input Catalog ID (optional).
    pub tic_id: Option<u64>,

    /// TESS camera number (optional).
    pub camera: Option<u8>,

    /// TESS CCD number (optional).
    pub ccd: Option<u8>,

    /// Verified Parquet object size in bytes.
    pub size_bytes: u64,

    /// SHA-256 checksum hex string of the Silver Parquet file.
    pub sha256: String,

    /// ISO-8601 timestamp when the Silver artifact was durably stored.
    pub occurred_at: String,
}
