use crate::event::{BronzeObjectReady, ProductKind};

fn target_pixel_json() -> &'static str {
    r#"{
        "event_id": "evt-001",
        "event_type": "bronze.object.ready",
        "source_product_id": "mast-prod-001",
        "sample_id": "tess-tic-123456789-sector-0042",
        "bucket": "aurora",
        "object_key": "bronze/tess/2024/sector-0042/123456789/tess123456789-s0042-1-1-0235-s_tp.fits",
        "product_kind": "TARGET_PIXEL",
        "sector": 42,
        "tic_id": 123456789,
        "camera": null,
        "ccd": null,
        "size_bytes": 1048576,
        "sha256": "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899",
        "occurred_at": "2026-08-07T06:00:00Z"
    }"#
}

fn light_curve_json() -> &'static str {
    r#"{
        "event_id": "evt-002",
        "event_type": "bronze.object.ready",
        "source_product_id": "mast-prod-002",
        "bucket": "aurora",
        "object_key": "bronze/tess/2024/sector-0042/123456789/tess123456789-s0042-s_lc.fits",
        "product_kind": "LIGHT_CURVE",
        "sector": 42,
        "tic_id": 123456789,
        "size_bytes": 524288,
        "sha256": "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899",
        "occurred_at": "2026-08-07T06:00:01Z"
    }"#
}

fn ffi_json() -> &'static str {
    r#"{
        "event_id": "evt-003",
        "event_type": "bronze.object.ready",
        "source_product_id": "mast-prod-003",
        "bucket": "aurora",
        "object_key": "bronze/tess/2024/sector-0042/ffi/tess2024001-s0042-1-1-ffic.fits",
        "product_kind": "FFI",
        "sector": 42,
        "camera": 1,
        "ccd": 2,
        "size_bytes": 67108864,
        "sha256": "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899",
        "occurred_at": "2026-08-07T06:00:02Z"
    }"#
}

#[test]
fn test_deserialize_target_pixel() {
    let event: BronzeObjectReady = serde_json::from_str(target_pixel_json()).unwrap();
    assert_eq!(event.product_kind, ProductKind::TargetPixel);
    assert_eq!(event.tic_id, Some(123456789));
    assert_eq!(event.sector, 42);
    assert!(event.camera.is_none());
}

#[test]
fn test_deserialize_light_curve() {
    let event: BronzeObjectReady = serde_json::from_str(light_curve_json()).unwrap();
    assert_eq!(event.product_kind, ProductKind::LightCurve);
    assert_eq!(event.tic_id, Some(123456789));
    assert!(event.sample_id.is_none());
}

#[test]
fn test_deserialize_ffi() {
    let event: BronzeObjectReady = serde_json::from_str(ffi_json()).unwrap();
    assert_eq!(event.product_kind, ProductKind::Ffi);
    assert_eq!(event.camera, Some(1));
    assert_eq!(event.ccd, Some(2));
    assert!(event.tic_id.is_none());
}

#[test]
fn test_optional_fields() {
    let event: BronzeObjectReady = serde_json::from_str(light_curve_json()).unwrap();
    assert!(event.sample_id.is_none());
    assert!(event.camera.is_none());
    assert!(event.ccd.is_none());
}

#[test]
fn test_unknown_product_kind_rejected() {
    let json = r#"{
        "event_id": "evt-bad",
        "event_type": "bronze.object.ready",
        "source_product_id": "x",
        "bucket": "aurora",
        "object_key": "some/key",
        "product_kind": "UNKNOWN_KIND",
        "sector": 1,
        "size_bytes": 100,
        "sha256": "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899",
        "occurred_at": "2026-08-07T00:00:00Z"
    }"#;
    let result = serde_json::from_str::<BronzeObjectReady>(json);
    assert!(result.is_err(), "UNKNOWN product_kind must be rejected");
}

#[test]
fn test_missing_required_field_rejected() {
    // Missing object_key
    let json = r#"{
        "event_id": "evt-bad",
        "event_type": "bronze.object.ready",
        "source_product_id": "x",
        "bucket": "aurora",
        "product_kind": "LIGHT_CURVE",
        "sector": 1,
        "size_bytes": 100,
        "sha256": "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899",
        "occurred_at": "2026-08-07T00:00:00Z"
    }"#;
    let result = serde_json::from_str::<BronzeObjectReady>(json);
    assert!(result.is_err(), "missing object_key must be rejected");
}

#[test]
fn test_missing_sha256_rejected() {
    let json = r#"{
        "event_id": "evt-bad",
        "event_type": "bronze.object.ready",
        "source_product_id": "x",
        "bucket": "aurora",
        "object_key": "some/key",
        "product_kind": "LIGHT_CURVE",
        "sector": 1,
        "size_bytes": 100,
        "occurred_at": "2026-08-07T00:00:00Z"
    }"#;
    let result = serde_json::from_str::<BronzeObjectReady>(json);
    assert!(result.is_err(), "missing sha256 must be rejected");
}

#[test]
fn test_invalid_json_rejected() {
    let result = serde_json::from_str::<BronzeObjectReady>("not json at all {{{");
    assert!(result.is_err(), "invalid JSON must be rejected");
}

#[test]
fn test_product_kind_target_pixel() {
    let tp: ProductKind = serde_json::from_str("\"TARGET_PIXEL\"").unwrap();
    assert_eq!(tp, ProductKind::TargetPixel);
}

#[test]
fn test_product_kind_light_curve() {
    let lc: ProductKind = serde_json::from_str("\"LIGHT_CURVE\"").unwrap();
    assert_eq!(lc, ProductKind::LightCurve);
}

#[test]
fn test_product_kind_ffi() {
    let ffi: ProductKind = serde_json::from_str("\"FFI\"").unwrap();
    assert_eq!(ffi, ProductKind::Ffi);
}

#[test]
fn test_product_kind_unknown_rejected() {
    let unknown = serde_json::from_str::<ProductKind>("\"UNKNOWN\"");
    assert!(
        unknown.is_err(),
        "UNKNOWN must not deserialize into ProductKind"
    );
}
