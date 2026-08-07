use crate::config::LightCurveConfig;
use crate::event::{BronzeObjectReady, ProductKind};
use crate::fits::RawLightCurve;
use crate::pipeline::lightcurve::{preprocess_lc, FluxSource, QualityMode};

fn make_event() -> BronzeObjectReady {
    BronzeObjectReady {
        event_id: "test-evt-001".to_string(),
        event_type: "bronze.object.ready".to_string(),
        source_product_id: "mast-001".to_string(),
        sample_id: None,
        bucket: "aurora".to_string(),
        object_key: "bronze/tess/sector-0042/123/file.fits".to_string(),
        product_kind: ProductKind::LightCurve,
        sector: 42,
        tic_id: Some(123456789),
        camera: Some(1),
        ccd: Some(2),
        size_bytes: 1024,
        sha256: "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899".to_string(),
        occurred_at: "2026-08-07T00:00:00Z".to_string(),
    }
}

fn default_config() -> LightCurveConfig {
    LightCurveConfig {
        min_points: 5,
        quality_mode: "strict".to_string(),
        allow_sap_fallback: false,
        sigma_clip: None,
    }
}

fn make_raw_lc(fluxes: Vec<f32>, qualities: Vec<i32>) -> RawLightCurve {
    let n = fluxes.len();
    let time: Vec<f64> = (0..n).map(|i| 100.0 + i as f64 * 0.02).collect();
    let errs: Vec<f32> = vec![1.0; n];
    RawLightCurve {
        time,
        sap_flux: None,
        sap_flux_err: None,
        pdcsap_flux: Some(fluxes),
        pdcsap_flux_err: Some(errs),
        quality: qualities,
        tic_id: Some(123456789),
    }
}

#[test]
fn test_valid_lc_preprocessing() {
    let raw = make_raw_lc(vec![1000.0, 1000.0, 1000.0, 1000.0, 1000.0], vec![0; 5]);
    let event = make_event();
    let cfg = default_config();

    let res = preprocess_lc(raw, &event, &cfg).unwrap();
    assert_eq!(res.time.len(), 5);
    assert_eq!(res.flux.len(), 5);
    assert_eq!(res.processing.input_points, 5);
    assert_eq!(res.processing.output_points, 5);
    assert_eq!(res.processing.quality_removed, 0);
    assert_eq!(res.processing.invalid_removed, 0);
    assert_eq!(res.processing.flux_source, FluxSource::Pdcsap);
    assert_eq!(res.processing.quality_mode, QualityMode::Strict);
    assert_eq!(res.processing.flux_median, 1000.0);

    // Median normalization: 1000.0 / 1000.0 - 1.0 = 0.0
    for &f in &res.flux {
        assert!((f - 0.0).abs() < 1e-6);
    }
}

#[test]
fn test_quality_strict_filtering() {
    // 3 good points (quality == 0), 2 bad points (quality != 0)
    let raw = make_raw_lc(
        vec![1000.0, 1000.0, 1000.0, 1000.0, 1000.0],
        vec![0, 1, 0, 4, 0],
    );
    let event = make_event();
    let mut cfg = default_config();
    cfg.min_points = 3;

    let res = preprocess_lc(raw, &event, &cfg).unwrap();
    assert_eq!(res.time.len(), 3);
    assert_eq!(res.processing.quality_removed, 2);
    assert_eq!(res.quality, vec![0, 0, 0]);
}

#[test]
fn test_quality_none_filtering() {
    let raw = make_raw_lc(
        vec![1000.0, 1000.0, 1000.0, 1000.0, 1000.0],
        vec![0, 1, 0, 4, 0],
    );
    let event = make_event();
    let mut cfg = default_config();
    cfg.quality_mode = "none".to_string();

    let res = preprocess_lc(raw, &event, &cfg).unwrap();
    assert_eq!(res.time.len(), 5);
    assert_eq!(res.processing.quality_removed, 0);
    assert_eq!(res.processing.quality_mode, QualityMode::None);
}

#[test]
fn test_non_finite_filtering() {
    let raw = make_raw_lc(
        vec![
            1000.0,
            f32::NAN,
            1000.0,
            f32::INFINITY,
            1000.0,
            1000.0,
            1000.0,
        ],
        vec![0, 0, 0, 0, 0, 0, 0],
    );
    let event = make_event();
    let cfg = default_config();

    let res = preprocess_lc(raw, &event, &cfg).unwrap();
    assert_eq!(res.time.len(), 5);
    assert_eq!(res.processing.invalid_removed, 2);
}

#[test]
fn test_sap_fallback() {
    let mut raw = make_raw_lc(vec![500.0, 500.0, 500.0, 500.0, 500.0], vec![0; 5]);
    raw.pdcsap_flux = None;
    raw.sap_flux = Some(vec![500.0, 500.0, 500.0, 500.0, 500.0]);

    let event = make_event();
    let mut cfg = default_config();
    cfg.allow_sap_fallback = true;

    let res = preprocess_lc(raw, &event, &cfg).unwrap();
    assert_eq!(res.processing.flux_source, FluxSource::Sap);
    assert_eq!(res.processing.flux_median, 500.0);
}

#[test]
fn test_missing_pdcsap_without_fallback_errors() {
    let mut raw = make_raw_lc(vec![500.0; 5], vec![0; 5]);
    raw.pdcsap_flux = None;
    raw.sap_flux = Some(vec![500.0; 5]);

    let event = make_event();
    let cfg = default_config(); // fallback false by default

    assert!(preprocess_lc(raw, &event, &cfg).is_err());
}

#[test]
fn test_insufficient_points_error() {
    let raw = make_raw_lc(vec![1000.0; 3], vec![0; 3]);
    let event = make_event();
    let mut cfg = default_config();
    cfg.min_points = 5;

    assert!(preprocess_lc(raw, &event, &cfg).is_err());
}

#[test]
fn test_invalid_median_zero_error() {
    let raw = make_raw_lc(vec![0.0; 5], vec![0; 5]);
    let event = make_event();
    let cfg = default_config();

    assert!(preprocess_lc(raw, &event, &cfg).is_err());
}

#[test]
fn test_transit_preservation() {
    // 20 points, baseline 1000.0 with a shallow 1% transit dip in points 8..12
    let mut fluxes = vec![1000.0; 20];
    for i in 8..12 {
        fluxes[i] = 990.0; // 1% transit dip
    }
    let raw = make_raw_lc(fluxes, vec![0; 20]);
    let event = make_event();
    let mut cfg = default_config();
    cfg.min_points = 10;
    cfg.sigma_clip = None; // disabled by default

    let res = preprocess_lc(raw, &event, &cfg).unwrap();
    assert_eq!(res.time.len(), 20);

    // Baseline points should be near 0.0 (or slightly positive due to transit median shift)
    // Dip points should remain negative and present in the output
    assert!(
        res.flux[9] < res.flux[0],
        "Transit dip point must remain lower than baseline"
    );
}

#[test]
fn test_gap_preservation() {
    let mut raw = make_raw_lc(vec![1000.0; 5], vec![0; 5]);
    raw.time = vec![1.0, 2.0, 3.0, 10.0, 11.0]; // gap between 3.0 and 10.0

    let event = make_event();
    let cfg = default_config();

    let res = preprocess_lc(raw, &event, &cfg).unwrap();
    assert_eq!(res.time, vec![1.0, 2.0, 3.0, 10.0, 11.0]);
}

#[test]
fn test_determinism() {
    let raw1 = make_raw_lc(vec![1000.0, 1005.0, 995.0, 1002.0, 998.0], vec![0; 5]);
    let raw2 = raw1.clone();
    let event = make_event();
    let cfg = default_config();

    let res1 = preprocess_lc(raw1, &event, &cfg).unwrap();
    let res2 = preprocess_lc(raw2, &event, &cfg).unwrap();

    assert_eq!(res1.time, res2.time);
    assert_eq!(res1.flux, res2.flux);
    assert_eq!(res1.quality, res2.quality);
    assert_eq!(res1.processing.flux_median, res2.processing.flux_median);
}
