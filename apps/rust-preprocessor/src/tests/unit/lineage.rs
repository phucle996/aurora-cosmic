use crate::checkpoint::ProcessingState;
use crate::event::ProductKind;
use crate::lineage::{
    build_lineage_object_key, derive_lineage_id, derive_processing_fingerprint,
    evaluate_eviction_eligibility, EvictionEligibility, LineageStatus, EVICTION_POLICY_V1,
};

// ---------------------------------------------------------------------------
// Key Derivation
// ---------------------------------------------------------------------------

#[test]
fn test_lineage_id_is_deterministic() {
    let id1 = derive_lineage_id("tess-lc-12345678-s1", "lc-preprocess-v1");
    let id2 = derive_lineage_id("tess-lc-12345678-s1", "lc-preprocess-v1");
    assert_eq!(id1, id2);
    assert_eq!(id1.len(), 64, "SHA256 hex must be 64 chars");
}

#[test]
fn test_lineage_id_differs_for_different_product() {
    let id_lc = derive_lineage_id("tess-lc-12345678-s1", "lc-preprocess-v1");
    let id_tpf = derive_lineage_id("tess-tpf-12345678-s1", "tpf-preprocess-v1");
    assert_ne!(id_lc, id_tpf);
}

#[test]
fn test_lineage_id_differs_for_different_processor_version() {
    let id_v1 = derive_lineage_id("tess-lc-12345678-s1", "lc-preprocess-v1");
    let id_v2 = derive_lineage_id("tess-lc-12345678-s1", "lc-preprocess-v2");
    assert_ne!(id_v1, id_v2);
}

#[test]
fn test_processing_fingerprint_is_deterministic() {
    let params = serde_json::json!({
        "min_points": 100,
        "quality_mode": "strict",
        "allow_sap_fallback": false,
        "sigma_clip": null
    });
    let fp1 = derive_processing_fingerprint("lc-preprocess-v1", &params);
    let fp2 = derive_processing_fingerprint("lc-preprocess-v1", &params);
    assert_eq!(fp1, fp2);
    assert_eq!(fp1.len(), 64);
}

#[test]
fn test_processing_fingerprint_differs_for_different_params() {
    let params_strict = serde_json::json!({"quality_mode": "strict", "min_points": 100});
    let params_none = serde_json::json!({"quality_mode": "none",   "min_points": 100});
    let fp1 = derive_processing_fingerprint("lc-preprocess-v1", &params_strict);
    let fp2 = derive_processing_fingerprint("lc-preprocess-v1", &params_none);
    assert_ne!(fp1, fp2);
}

// ---------------------------------------------------------------------------
// Object Key Layout
// ---------------------------------------------------------------------------

#[test]
fn test_lineage_key_lightcurve() {
    let key = build_lineage_object_key(&ProductKind::LightCurve, "abc123");
    assert_eq!(key, "lineage/v1/tess/lightcurve/abc123.json");
}

#[test]
fn test_lineage_key_target_pixel() {
    let key = build_lineage_object_key(&ProductKind::TargetPixel, "def456");
    assert_eq!(key, "lineage/v1/tess/target-pixel/def456.json");
}

#[test]
fn test_lineage_key_ffi() {
    let key = build_lineage_object_key(&ProductKind::Ffi, "ghi789");
    assert_eq!(key, "lineage/v1/tess/ffi/ghi789.json");
}

// ---------------------------------------------------------------------------
// Eviction Eligibility Policy
// ---------------------------------------------------------------------------

fn completed() -> ProcessingState {
    ProcessingState::Completed
}
fn failed() -> ProcessingState {
    ProcessingState::Failed
}
fn processing() -> ProcessingState {
    ProcessingState::Processing
}

#[test]
fn test_eviction_eligible_when_all_conditions_met() {
    let result = evaluate_eviction_eligibility(
        &Some("https://mast.stsci.edu/file.fits".to_string()),
        &completed(),
        "abc123sha256",
    );
    assert!(result.eligible);
    assert_eq!(result.policy_version, EVICTION_POLICY_V1);
    assert_eq!(result.reason, "SUCCESSFUL_SILVER_DURABLE");
}

#[test]
fn test_eviction_blocked_when_source_uri_missing() {
    let result = evaluate_eviction_eligibility(&None, &completed(), "abc123sha256");
    assert!(!result.eligible);
    assert_eq!(result.reason, "SOURCE_URI_MISSING");
}

#[test]
fn test_eviction_blocked_when_checkpoint_failed() {
    let result = evaluate_eviction_eligibility(
        &Some("https://mast.stsci.edu/file.fits".to_string()),
        &failed(),
        "abc123sha256",
    );
    assert!(!result.eligible);
    assert_eq!(result.reason, "PROCESSING_REJECTED");
}

#[test]
fn test_eviction_blocked_when_checkpoint_processing() {
    let result = evaluate_eviction_eligibility(
        &Some("https://mast.stsci.edu/file.fits".to_string()),
        &processing(),
        "abc123",
    );
    assert!(!result.eligible);
    assert_eq!(result.reason, "CHECKPOINT_NOT_COMPLETED");
}

#[test]
fn test_eviction_blocked_when_silver_sha256_empty() {
    let result = evaluate_eviction_eligibility(
        &Some("https://mast.stsci.edu/file.fits".to_string()),
        &completed(),
        "",
    );
    assert!(!result.eligible);
    assert_eq!(result.reason, "SILVER_MISSING");
}

// ---------------------------------------------------------------------------
// EvictionEligibility struct
// ---------------------------------------------------------------------------

#[test]
fn test_eviction_eligible_constructor() {
    let e = EvictionEligibility::eligible();
    assert!(e.eligible);
    assert_eq!(e.policy_version, EVICTION_POLICY_V1);
}

#[test]
fn test_eviction_blocked_constructor() {
    let e = EvictionEligibility::blocked("CUSTOM_REASON");
    assert!(!e.eligible);
    assert_eq!(e.reason, "CUSTOM_REASON");
}

// ---------------------------------------------------------------------------
// Serde round-trips
// ---------------------------------------------------------------------------

#[test]
fn test_lineage_status_serializes_screaming_snake_case() {
    let json = serde_json::to_string(&LineageStatus::LineageCommitted).unwrap();
    assert_eq!(json, r#""LINEAGE_COMMITTED""#);
}

#[test]
fn test_eviction_eligibility_round_trips_json() {
    let e = EvictionEligibility::eligible();
    let json = serde_json::to_string(&e).unwrap();
    let back: EvictionEligibility = serde_json::from_str(&json).unwrap();
    assert_eq!(back.eligible, e.eligible);
    assert_eq!(back.reason, e.reason);
    assert_eq!(back.policy_version, e.policy_version);
}
