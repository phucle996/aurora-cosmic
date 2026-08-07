use tempfile::tempdir;

use crate::config::{ImageConfig, LightCurveConfig};
use crate::event::{BronzeObjectReady, ProductKind};
use crate::output::silver::{
    build_ffi_key, build_lc_key, build_tpf_key, serialize_ffi, serialize_lightcurve,
    serialize_target_pixel,
};
use crate::pipeline::image::{preprocess_ffi, preprocess_target_pixel};
use crate::pipeline::lightcurve::preprocess_lc;

fn make_event(kind: ProductKind, event_id: &str) -> BronzeObjectReady {
    BronzeObjectReady {
        event_id: event_id.to_string(),
        event_type: "bronze.object.ready".to_string(),
        source_product_id: format!("tess-prod-{event_id}"),
        sample_id: None,
        bucket: "aurora".to_string(),
        object_key: format!("bronze/tess/sector-0042/123/{event_id}.fits"),
        product_kind: kind,
        sector: 42,
        tic_id: Some(123456789),
        camera: Some(1),
        ccd: Some(2),
        size_bytes: 2048,
        sha256: "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899".to_string(),
        occurred_at: "2026-08-07T00:00:00Z".to_string(),
    }
}

fn default_lc_config() -> LightCurveConfig {
    LightCurveConfig {
        min_points: 5,
        quality_mode: "strict".to_string(),
        allow_sap_fallback: false,
        sigma_clip: None,
    }
}

fn default_img_config() -> ImageConfig {
    ImageConfig {
        tpf_quality_mode: "strict".to_string(),
        tpf_normalization: "temporal-median".to_string(),
        ffi_normalization: "median".to_string(),
        ffi_cutout_size: 32,
    }
}

#[test]
fn test_e2e_light_curve_pipeline_flow() {
    let tmp_dir = tempdir().unwrap();
    let event = make_event(ProductKind::LightCurve, "lc-001");
    let lc_cfg = default_lc_config();

    let raw_lc = crate::fits::RawLightCurve {
        time: vec![100.0, 100.02, 100.04, 100.06, 100.08],
        sap_flux: None,
        sap_flux_err: None,
        pdcsap_flux: Some(vec![1000.0, 990.0, 1000.0, 1000.0, 1000.0]), // 1% transit dip preserved
        pdcsap_flux_err: Some(vec![1.0, 1.0, 1.0, 1.0, 1.0]),
        quality: vec![0, 0, 0, 0, 0],
        tic_id: Some(123456789),
    };

    // 1. Scientific Preprocessing
    let processed = preprocess_lc(raw_lc, &event, &lc_cfg).unwrap();
    assert_eq!(processed.time.len(), 5);
    assert_eq!(processed.processing.processor_version, "lc-preprocess-v1");

    // 2. Parquet Arrow Serialization
    let artifact = serialize_lightcurve(&processed, &event, tmp_dir.path()).unwrap();

    // 3. Verification of Silver Metadata & Key
    let expected_key = build_lc_key(
        event.sector,
        event.tic_id,
        &event.source_product_id,
        "lc-preprocess-v1",
    );
    assert_eq!(artifact.object_key, expected_key);
    assert_eq!(artifact.schema_version, "silver-lightcurve-v1");
    assert_eq!(artifact.processor_version, "lc-preprocess-v1");
    assert!(artifact.size_bytes > 0);
    assert_eq!(artifact.sha256.len(), 64);
}

#[test]
fn test_e2e_tpf_pipeline_flow() {
    let tmp_dir = tempdir().unwrap();
    let event = make_event(ProductKind::TargetPixel, "tpf-001");
    let img_cfg = default_img_config();

    let raw_tpf = crate::fits::RawTargetPixel {
        time: vec![1.0, 2.0],
        quality: vec![0, 0],
        flux: vec![
            vec![vec![100.0, 200.0], vec![300.0, 400.0]],
            vec![vec![100.0, 200.0], vec![300.0, 400.0]],
        ],
        rows: 2,
        cols: 2,
        tic_id: Some(123456789),
    };

    let processed = preprocess_target_pixel(raw_tpf, &event, &img_cfg).unwrap();
    assert_eq!(processed.processing.processor_version, "tpf-preprocess-v1");

    let artifact = serialize_target_pixel(&processed, &event, tmp_dir.path()).unwrap();
    let expected_key = build_tpf_key(
        event.sector,
        event.tic_id,
        &event.source_product_id,
        "tpf-preprocess-v1",
    );
    assert_eq!(artifact.object_key, expected_key);
    assert_eq!(artifact.schema_version, "silver-target-pixel-v1");
    assert!(artifact.size_bytes > 0);
}

#[test]
fn test_e2e_ffi_pipeline_flow() {
    let tmp_dir = tempdir().unwrap();
    let event = make_event(ProductKind::Ffi, "ffi-001");
    let img_cfg = default_img_config();

    let raw_ffi = crate::fits::RawFfi {
        width: 4,
        height: 4,
        pixels: vec![
            10.0, 20.0, 30.0, 40.0, 50.0, 60.0, 70.0, 80.0, 90.0, 100.0, 110.0, 120.0, 130.0,
            140.0, 150.0, 160.0,
        ],
    };

    let processed = preprocess_ffi(raw_ffi, &event, &img_cfg, Some(&[(1, 1, 2, 2)])).unwrap();
    assert_eq!(processed.processing.processor_version, "ffi-preprocess-v1");
    assert_eq!(processed.cutouts.len(), 1);

    let artifact = serialize_ffi(&processed, &event, tmp_dir.path()).unwrap();
    let expected_key = build_ffi_key(
        event.sector,
        event.camera,
        event.ccd,
        &event.source_product_id,
        "ffi-preprocess-v1",
    );
    assert_eq!(artifact.object_key, expected_key);
    assert_eq!(artifact.schema_version, "silver-ffi-v1");
    assert!(artifact.size_bytes > 0);
}
