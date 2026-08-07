use crate::event::{ProductKind, SilverObjectReady};

#[test]
fn test_silver_object_ready_event_serialization() {
    let silver_event = SilverObjectReady {
        event_id: "evt-silver-123".to_string(),
        event_type: "silver.object.ready".to_string(),
        source_event_id: "evt-bronze-456".to_string(),
        source_product_id: "tess2021204101400-s0042-0000000123456789".to_string(),
        sample_id: Some("sample-789".to_string()),
        bucket: "aurora".to_string(),
        object_key: "silver/tess/lightcurve/processor=lc-preprocess-v1/sector=0042/tic=123456789/lc.parquet".to_string(),
        product_kind: ProductKind::LightCurve,
        schema_version: "silver-lightcurve-v1".to_string(),
        processor_version: "lc-preprocess-v1".to_string(),
        sector: 42,
        tic_id: Some(123456789),
        camera: None,
        ccd: None,
        size_bytes: 45678,
        sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855".to_string(),
        occurred_at: "2026-08-07T18:00:00Z".to_string(),
    };

    let json_bytes = serde_json::to_vec(&silver_event).expect("Serialization failed");
    let deserialized: SilverObjectReady = serde_json::from_slice(&json_bytes).expect("Deserialization failed");

    assert_eq!(silver_event, deserialized);
    assert_eq!(deserialized.event_type, "silver.object.ready");
}
