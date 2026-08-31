use crate::config::ImageConfig;
use crate::event::{BronzeObjectReady, ProductKind};
use crate::fits::{RawFfi, RawTargetPixel};
use crate::pipeline::image::{preprocess_ffi, preprocess_target_pixel};

fn make_tpf_event() -> BronzeObjectReady {
    BronzeObjectReady {
        event_id: "evt-tpf-001".to_string(),
        event_type: "bronze.object.ready".to_string(),
        source_product_id: "tess-tpf-001".to_string(),
        sample_id: None,
        bucket: "aurora".to_string(),
        object_key: "bronze/tess/target-pixel/sector=0042/tic=123456789/tpf.fits".to_string(),
        product_kind: ProductKind::TargetPixel,
        sector: 42,
        tic_id: Some(123456789),
        camera: Some(1),
        ccd: Some(2),
        size_bytes: 4096,
        sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef".to_string(),
        occurred_at: "2026-08-07T00:00:00Z".to_string(),
    }
}

fn make_ffi_event() -> BronzeObjectReady {
    BronzeObjectReady {
        event_id: "evt-ffi-001".to_string(),
        event_type: "bronze.object.ready".to_string(),
        source_product_id: "tess-ffi-001".to_string(),
        sample_id: None,
        bucket: "aurora".to_string(),
        object_key: "bronze/tess/ffi/sector=0042/camera=1/ccd=2/ffi.fits".to_string(),
        product_kind: ProductKind::Ffi,
        sector: 42,
        tic_id: None,
        camera: Some(1),
        ccd: Some(2),
        size_bytes: 8192,
        sha256: "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210".to_string(),
        occurred_at: "2026-08-07T00:00:00Z".to_string(),
    }
}

fn default_image_config() -> ImageConfig {
    ImageConfig {
        tpf_quality_mode: "strict".to_string(),
        tpf_normalization: "temporal-median".to_string(),
        tpf_chunk_cadences: 256,
        ffi_normalization: "median".to_string(),
    }
}

#[test]
fn test_tpf_preprocessing_valid() {
    let raw = RawTargetPixel {
        time: vec![1.0, 2.0, 3.0],
        quality: vec![0, 0, 0],
        flux: vec![
            vec![vec![100.0, 200.0], vec![300.0, 400.0]],
            vec![vec![100.0, 200.0], vec![300.0, 400.0]],
            vec![vec![100.0, 200.0], vec![300.0, 400.0]],
        ],
        rows: 2,
        cols: 2,
        tic_id: Some(123456789),
    };
    let event = make_tpf_event();
    let cfg = default_image_config();

    let res = preprocess_target_pixel(raw, &event, &cfg).unwrap();
    assert_eq!(res.time.len(), 3);
    assert_eq!(res.rows, 2);
    assert_eq!(res.cols, 2);
    assert_eq!(res.processing.output_cadences, 3);
    assert_eq!(res.processing.quality_removed, 0);

    // Temporal median of pixel (0,0) is 100.0 -> normalized = (100.0/100.0) - 1.0 = 0.0
    for cad in 0..3 {
        assert!((res.flux[cad][0][0] - 0.0).abs() < 1e-6);
        assert!((res.flux[cad][1][1] - 0.0).abs() < 1e-6);
    }
}

#[test]
fn test_tpf_quality_strict_filtering() {
    let raw = RawTargetPixel {
        time: vec![1.0, 2.0, 3.0],
        quality: vec![0, 128, 0], // middle cadence rejected
        flux: vec![
            vec![vec![100.0, 200.0], vec![300.0, 400.0]],
            vec![vec![999.0, 999.0], vec![999.0, 999.0]],
            vec![vec![100.0, 200.0], vec![300.0, 400.0]],
        ],
        rows: 2,
        cols: 2,
        tic_id: Some(123456789),
    };
    let event = make_tpf_event();
    let cfg = default_image_config();

    let res = preprocess_target_pixel(raw, &event, &cfg).unwrap();
    assert_eq!(res.time.len(), 2);
    assert_eq!(res.processing.quality_removed, 1);
    assert_eq!(res.quality, vec![0, 0]);
}

#[test]
fn test_tpf_invalid_time_filtering() {
    let raw = RawTargetPixel {
        time: vec![1.0, f64::NAN, 3.0],
        quality: vec![0, 0, 0],
        flux: vec![
            vec![vec![100.0, 200.0], vec![300.0, 400.0]],
            vec![vec![100.0, 200.0], vec![300.0, 400.0]],
            vec![vec![100.0, 200.0], vec![300.0, 400.0]],
        ],
        rows: 2,
        cols: 2,
        tic_id: Some(123456789),
    };
    let event = make_tpf_event();
    let cfg = default_image_config();

    let res = preprocess_target_pixel(raw, &event, &cfg).unwrap();
    assert_eq!(res.time.len(), 2);
    assert_eq!(res.processing.invalid_time_removed, 1);
}

#[test]
fn test_tpf_zero_reference_pixel_handling() {
    let raw = RawTargetPixel {
        time: vec![1.0, 2.0],
        quality: vec![0, 0],
        flux: vec![
            vec![vec![0.0, 200.0], vec![300.0, 400.0]],
            vec![vec![0.0, 200.0], vec![300.0, 400.0]],
        ],
        rows: 2,
        cols: 2,
        tic_id: Some(123456789),
    };
    let event = make_tpf_event();
    let cfg = default_image_config();

    let res = preprocess_target_pixel(raw, &event, &cfg).unwrap();
    // Zero reference pixel (0,0) must not divide by zero or produce NaN/Inf
    assert_eq!(res.flux[0][0][0], 0.0);
    assert!(!res.flux[0][0][0].is_nan());
}

#[test]
fn test_tpf_temporal_variation_preserved() {
    // 3 cadences, pixel (0,0) has 1% dip in middle cadence
    let raw = RawTargetPixel {
        time: vec![1.0, 2.0, 3.0],
        quality: vec![0, 0, 0],
        flux: vec![
            vec![vec![1000.0]],
            vec![vec![990.0]], // 1% dip
            vec![vec![1000.0]],
        ],
        rows: 1,
        cols: 1,
        tic_id: Some(123456789),
    };
    let event = make_tpf_event();
    let cfg = default_image_config();

    let res = preprocess_target_pixel(raw, &event, &cfg).unwrap();
    assert_eq!(res.time.len(), 3);
    assert!(
        res.flux[1][0][0] < res.flux[0][0][0],
        "Middle dip cadence must be lower than baseline"
    );
}

#[test]
fn test_tpf_global_median_normalization() {
    let raw = RawTargetPixel {
        time: vec![1.0, 2.0],
        quality: vec![0, 0],
        flux: vec![vec![vec![10.0, 20.0]], vec![vec![10.0, 20.0]]],
        rows: 1,
        cols: 2,
        tic_id: Some(123456789),
    };
    let event = make_tpf_event();
    let mut cfg = default_image_config();
    cfg.tpf_normalization = "global-median".to_string();

    let res = preprocess_target_pixel(raw, &event, &cfg).unwrap();
    // Global median is 15: values become -1/3 and +1/3.
    assert!((res.flux[0][0][0] + (1.0 / 3.0)).abs() < 1e-6);
    assert!((res.flux[0][0][1] - (1.0 / 3.0)).abs() < 1e-6);
}

#[test]
fn test_tpf_none_normalization_preserves_flux() {
    let raw = RawTargetPixel {
        time: vec![1.0],
        quality: vec![0],
        flux: vec![vec![vec![10.0]]],
        rows: 1,
        cols: 1,
        tic_id: Some(123456789),
    };
    let event = make_tpf_event();
    let mut cfg = default_image_config();
    cfg.tpf_normalization = "none".to_string();

    let res = preprocess_target_pixel(raw, &event, &cfg).unwrap();
    assert_eq!(res.flux[0][0][0], 10.0);
}

#[test]
fn test_tpf_chunk_temporal_median_is_versioned_separately() {
    let raw = RawTargetPixel {
        time: vec![1.0, 2.0],
        quality: vec![0, 0],
        flux: vec![vec![vec![100.0]], vec![vec![110.0]]],
        rows: 1,
        cols: 1,
        tic_id: Some(123456789),
    };
    let event = make_tpf_event();
    let mut cfg = default_image_config();
    cfg.tpf_normalization = "chunk-temporal-median".to_string();

    let result = preprocess_target_pixel(raw, &event, &cfg).unwrap();
    assert_eq!(
        result.processing.processor_version,
        "tpf-preprocess-v2-chunked"
    );
    assert_eq!(
        result.processing.normalization_mode,
        "chunk-temporal-median"
    );
}

#[test]
fn test_tpf_determinism() {
    let raw1 = RawTargetPixel {
        time: vec![1.0, 2.0],
        quality: vec![0, 0],
        flux: vec![
            vec![vec![100.0, 200.0], vec![300.0, 400.0]],
            vec![vec![102.0, 198.0], vec![301.0, 399.0]],
        ],
        rows: 2,
        cols: 2,
        tic_id: Some(123456789),
    };
    let raw2 = raw1.clone();
    let event = make_tpf_event();
    let cfg = default_image_config();

    let res1 = preprocess_target_pixel(raw1, &event, &cfg).unwrap();
    let res2 = preprocess_target_pixel(raw2, &event, &cfg).unwrap();

    assert_eq!(res1.time, res2.time);
    assert_eq!(res1.flux, res2.flux);
}

#[test]
fn test_ffi_statistics_and_non_finite_handling() {
    let pixels = vec![
        10.0,
        20.0,
        f32::NAN,
        40.0,
        50.0,
        60.0,
        70.0,
        f32::INFINITY,
        90.0,
        100.0,
        110.0,
        120.0,
        130.0,
        140.0,
        150.0,
        160.0,
    ];
    let raw = RawFfi {
        width: 4,
        height: 4,
        pixels,
    };
    let event = make_ffi_event();
    let cfg = default_image_config();

    let res = preprocess_ffi(raw, &event, &cfg, None).unwrap();
    assert_eq!(res.width, 4);
    assert_eq!(res.height, 4);
    assert_eq!(res.statistics.finite_pixel_count, 14);
    assert!((res.statistics.finite_pixel_fraction - 14.0 / 16.0).abs() < 1e-6);
    assert!((res.statistics.min - (10.0 / 95.0 - 1.0)).abs() < 1e-6);
    assert!((res.statistics.max - (160.0 / 95.0 - 1.0)).abs() < 1e-6);
}

#[test]
fn test_ffi_cutout_extraction() {
    let pixels = vec![
        1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 11.0, 12.0, 13.0, 14.0, 15.0, 16.0,
    ];
    let raw = RawFfi {
        width: 4,
        height: 4,
        pixels,
    };
    let event = make_ffi_event();
    let cfg = default_image_config();

    // Extract 2x2 cutout at x=1, y=1
    let cutouts_req = vec![(1, 1, 2, 2)];
    let res = preprocess_ffi(raw, &event, &cfg, Some(&cutouts_req)).unwrap();

    assert_eq!(res.cutouts.len(), 1);
    let cutout = &res.cutouts[0];
    assert_eq!(cutout.x, 1);
    assert_eq!(cutout.y, 1);
    assert_eq!(cutout.width, 2);
    assert_eq!(cutout.height, 2);
    // Rows 1 and 2, cols 1 and 2, normalized against the image median 8.5.
    let expected = vec![6.0, 7.0, 10.0, 11.0]
        .into_iter()
        .map(|pixel| pixel / 8.5 - 1.0)
        .collect::<Vec<f32>>();
    assert_eq!(cutout.pixels, expected);
}

#[test]
fn test_ffi_invalid_cutout_bounds_error() {
    let raw = RawFfi {
        width: 4,
        height: 4,
        pixels: vec![1.0; 16],
    };
    let event = make_ffi_event();
    let cfg = default_image_config();

    // Out of bounds cutout at x=3, y=3, w=2, h=2 (exceeds width/height 4)
    let cutouts_req = vec![(3, 3, 2, 2)];
    assert!(preprocess_ffi(raw, &event, &cfg, Some(&cutouts_req)).is_err());
}
