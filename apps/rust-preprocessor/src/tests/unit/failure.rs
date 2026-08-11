use crate::failure::{classify_pipeline_error, ErrorKind, FailureClass};

fn make_err(msg: &str) -> anyhow::Error {
    anyhow::anyhow!("{}", msg)
}

#[test]
fn test_classify_minio_timeout_is_retryable() {
    let err = make_err("MinIO stat failed — object may not exist: aurora-bronze/some-key");
    let f = classify_pipeline_error(&err);
    assert_eq!(f.class, FailureClass::Retryable);
    assert_eq!(f.kind, ErrorKind::BronzeNotFound);
}

#[test]
fn test_classify_checksum_mismatch_is_conflict() {
    let err =
        make_err("SHA-256 checksum mismatch for aurora-bronze/key: expected=abc computed=def");
    let f = classify_pipeline_error(&err);
    assert_eq!(f.class, FailureClass::Conflict);
    assert_eq!(f.kind, ErrorKind::BronzeIntegrityMismatch);
}

#[test]
fn test_classify_size_mismatch_is_conflict() {
    let err = make_err("Size mismatch for aurora-bronze/key: expected=1024 actual=512");
    let f = classify_pipeline_error(&err);
    assert_eq!(f.class, FailureClass::Conflict);
    assert_eq!(f.kind, ErrorKind::BronzeIntegrityMismatch);
}

#[test]
fn test_classify_fits_decode_is_terminal() {
    let err = make_err("FITS decode error: unexpected HDU structure");
    let f = classify_pipeline_error(&err);
    assert_eq!(f.class, FailureClass::Terminal);
    assert_eq!(f.kind, ErrorKind::FitsDecodeFailed);
}

#[test]
fn test_classify_too_few_lc_points_is_rejected() {
    let err = make_err("too few valid cadences: 20 < min_points=100");
    let f = classify_pipeline_error(&err);
    assert_eq!(f.class, FailureClass::Rejected);
    assert_eq!(f.kind, ErrorKind::PreprocessingRejected);
}

#[test]
fn test_classify_insufficient_points_is_rejected() {
    let err = make_err("insufficient points after quality filtering: 0 remaining");
    let f = classify_pipeline_error(&err);
    assert_eq!(f.class, FailureClass::Rejected);
    assert_eq!(f.kind, ErrorKind::PreprocessingRejected);
}

#[test]
fn test_classify_normalization_median_zero_is_rejected() {
    let err = make_err("normalization median is zero — cannot normalize flux");
    let f = classify_pipeline_error(&err);
    assert_eq!(f.class, FailureClass::Rejected);
    assert_eq!(f.kind, ErrorKind::PreprocessingRejected);
}

#[test]
fn test_classify_silver_write_failed_is_retryable() {
    let err = make_err("MinIO PutObject failed for aurora-silver/lc/path/file.parquet");
    let f = classify_pipeline_error(&err);
    assert_eq!(f.class, FailureClass::Retryable);
    assert_eq!(f.kind, ErrorKind::SilverWriteFailed);
}

#[test]
fn test_classify_unknown_error_is_retryable() {
    let err = make_err("unexpected io error: connection reset by peer");
    let f = classify_pipeline_error(&err);
    assert_eq!(f.class, FailureClass::Retryable);
    assert_eq!(f.kind, ErrorKind::InternalTemporary);
}

#[test]
fn test_retryable_is_not_terminal() {
    let err = make_err("MinIO stat failed — object may not exist: bucket/key");
    let f = classify_pipeline_error(&err);
    assert_ne!(f.class, FailureClass::Terminal);
    assert_ne!(f.class, FailureClass::Conflict);
    assert_ne!(f.class, FailureClass::Rejected);
}
