use thiserror::Error;

#[derive(Error, Debug)]
pub enum RuntimeError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON serialization error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Package integrity mismatch: {0}")]
    Integrity(String),

    #[error("Parity validation failed: {0}")]
    ParityFailed(String),

    #[error("Unknown feature in input: {0}")]
    UnknownFeature(String),

    #[error("Missing feature key in input: {0}")]
    MissingFeature(String),

    #[error("Invalid runtime package: {0}")]
    InvalidPackage(String),

    #[error("Invalid model output: {0}")]
    InvalidOutput(String),

    #[error("ONNX Runtime error: {0}")]
    Ort(String),
}
