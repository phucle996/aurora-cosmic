use serde::{Deserialize, Serialize};

/// AURORA FITS product kind — frozen contract from Stage 2.
/// Maps directly to the `product_kind` field in `bronze-object-ready` events.
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
/// Rust does NOT depend on MAST URL, discovery params, manifest path, or Go
/// checkpoint internals — only the frozen downstream fields.
#[derive(Debug, Clone, Deserialize)]
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
