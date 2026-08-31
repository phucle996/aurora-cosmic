use crate::checkpoint::{
    build_checkpoint_object_key, derive_checkpoint_id, PreprocessingCheckpoint, ProcessingState,
    CURRENT_CHECKPOINT_SCHEMA_VERSION,
};
use crate::event::{BronzeObjectReady, ProductKind};

fn make_event() -> BronzeObjectReady {
    BronzeObjectReady {
        event_id: "evt-001".to_string(),
        event_type: "bronze.object.ready".to_string(),
        source_product_id: "tess2021204101400-s0042-0000000123456789".to_string(),
        sample_id: None,
        bucket: "aurora".to_string(),
        object_key: "bronze/tess/lightcurve/sector=0042/tic=123456789/lc.fits".to_string(),
        product_kind: ProductKind::LightCurve,
        sector: 42,
        tic_id: Some(123456789),
        camera: Some(1),
        ccd: Some(2),
        size_bytes: 2048,
        sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef".to_string(),
        occurred_at: "2026-08-07T00:00:00Z".to_string(),
    }
}

#[test]
fn test_checkpoint_serialization_roundtrip() {
    let event = make_event();
    let mut cp = PreprocessingCheckpoint::new(&event, "lc-preprocess-v1", "test-config");

    assert_eq!(cp.schema_version, CURRENT_CHECKPOINT_SCHEMA_VERSION);
    assert_eq!(cp.state, ProcessingState::Processing);
    assert_eq!(cp.attempts, 1);

    cp.silver_bucket = Some("aurora".to_string());
    cp.silver_object_key = Some("silver/tess/lc.parquet".to_string());
    cp.silver_sha256 =
        Some("fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210".to_string());
    cp.silver_size_bytes = Some(4096);
    cp.silver_schema_version = Some("silver-lightcurve-v1".to_string());
    cp.state = ProcessingState::SilverStored;

    assert_eq!(cp.state, ProcessingState::SilverStored);
    assert_eq!(cp.silver_size_bytes, Some(4096));

    cp.mark_completed();
    assert_eq!(cp.state, ProcessingState::Completed);

    // JSON roundtrip
    let json_bytes = serde_json::to_vec(&cp).unwrap();
    let deserialized: PreprocessingCheckpoint = serde_json::from_slice(&json_bytes).unwrap();

    assert_eq!(deserialized.checkpoint_id, cp.checkpoint_id);
    assert_eq!(deserialized.state, ProcessingState::Completed);
    assert_eq!(
        deserialized.silver_object_key,
        Some("silver/tess/lc.parquet".to_string())
    );
}

#[test]
fn test_schema_version_validation() {
    let event = make_event();
    let mut cp = PreprocessingCheckpoint::new(&event, "lc-preprocess-v1", "test-config");
    assert!(cp.validate_schema_version().is_ok());

    cp.schema_version = 999;
    assert!(cp.validate_schema_version().is_err());
}

#[test]
fn test_deterministic_checkpoint_id() {
    let id1 = derive_checkpoint_id("product-001", "v1", "config-a");
    let id2 = derive_checkpoint_id("product-001", "v1", "config-a");
    assert_eq!(id1, id2);

    let id_v2 = derive_checkpoint_id("product-001", "v2", "config-a");
    assert_ne!(id1, id_v2);

    let id_config_b = derive_checkpoint_id("product-001", "v1", "config-b");
    assert_ne!(id1, id_config_b);

    let key = build_checkpoint_object_key(&id1);
    assert_eq!(key, format!("checkpoints/preprocessing/objects/{id1}.json"));
}

#[test]
fn test_checkpoint_failure_state() {
    let event = make_event();
    let mut cp = PreprocessingCheckpoint::new(&event, "lc-preprocess-v1", "test-config");

    cp.mark_failed("MinIO upload timeout");
    assert_eq!(cp.state, ProcessingState::Failed);
    assert_eq!(cp.last_error, Some("MinIO upload timeout".to_string()));
}
