use serde::{Deserialize, Serialize};

/// Classification of failure type — determines retry vs terminal broker action.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FailureClass {
    /// Temporary infrastructure failure — eligible for JetStream redelivery.
    Retryable,
    /// Deterministic unrecoverable failure — stop redelivery.
    Terminal,
    /// Integrity/lineage conflict — preserve artifacts, stop redelivery.
    Conflict,
    /// Scientifically unusable product — deterministic, stop redelivery.
    Rejected,
}

/// Stable error code for machine policy decisions.
///
/// Do not encode human messages into these codes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorKind {
    /// Malformed JSON event payload.
    EventInvalid,
    /// Unsupported event schema version or product kind.
    EventUnsupported,
    /// Bronze object not found in MinIO (may be retried).
    BronzeNotFound,
    /// Bronze SHA-256 or size mismatch — event lineage conflict.
    BronzeIntegrityMismatch,
    /// FITS decode or parse error (non-retryable if structural).
    FitsDecodeFailed,
    /// Valid FITS but scientifically unusable (too few points, invalid shape, etc.).
    PreprocessingRejected,
    /// Temporary MinIO Silver PUT failure.
    SilverWriteFailed,
    /// Silver object lineage conflict at deterministic key.
    SilverConflict,
    /// Checkpoint write conflict or integrity issue.
    CheckpointConflict,
    /// Temporary infrastructure failure (MinIO timeout, NATS transient, disk I/O).
    InternalTemporary,
}

/// Structured failure descriptor produced during processing.
#[derive(Debug, Clone)]
pub struct ProcessingFailure {
    pub class: FailureClass,
    pub kind: ErrorKind,
    pub message: String,
}

impl ProcessingFailure {
    pub fn retryable(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            class: FailureClass::Retryable,
            kind,
            message: message.into(),
        }
    }

    pub fn terminal(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            class: FailureClass::Terminal,
            kind,
            message: message.into(),
        }
    }

    pub fn conflict(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            class: FailureClass::Conflict,
            kind,
            message: message.into(),
        }
    }

    pub fn rejected(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            class: FailureClass::Rejected,
            kind,
            message: message.into(),
        }
    }
}

/// Classify an anyhow error from pipeline execution into a structured failure.
///
/// This is the primary policy point — do not spread classification logic across modules.
pub fn classify_pipeline_error(err: &anyhow::Error) -> ProcessingFailure {
    let msg = err.to_string();

    // Bronze integrity / checksum
    if msg.contains("SHA-256 checksum mismatch") || msg.contains("Size mismatch") {
        return ProcessingFailure::conflict(ErrorKind::BronzeIntegrityMismatch, msg);
    }

    // Bronze not found / stat failure
    if msg.contains("MinIO stat failed") || msg.contains("object may not exist") {
        return ProcessingFailure::retryable(ErrorKind::BronzeNotFound, msg);
    }

    // FITS decode errors — deterministic structural failures
    if msg.contains("FITS") || msg.contains("fitsio") || msg.contains("decode") {
        return ProcessingFailure::terminal(ErrorKind::FitsDecodeFailed, msg);
    }

    // Scientific rejection — deterministic data quality failures
    if msg.contains("too few valid")
        || msg.contains("insufficient points")
        || msg.contains("normalization median is zero")
        || msg.contains("Not enough usable")
    {
        return ProcessingFailure::rejected(ErrorKind::PreprocessingRejected, msg);
    }

    // Silver upload failure — retryable infrastructure
    if msg.contains("MinIO PutObject failed") || msg.contains("Silver upload failed") {
        return ProcessingFailure::retryable(ErrorKind::SilverWriteFailed, msg);
    }

    // Default: treat as temporary internal failure — bounded redelivery will handle escalation
    ProcessingFailure::retryable(ErrorKind::InternalTemporary, msg)
}
