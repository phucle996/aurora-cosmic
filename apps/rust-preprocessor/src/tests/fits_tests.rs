use crate::event::{BronzeObjectReady, ProductKind};
use crate::fits::{DecodedProduct, RawFfi, RawLightCurve, RawTargetPixel};

fn make_event(kind: ProductKind) -> BronzeObjectReady {
    BronzeObjectReady {
        event_id: "test-evt-001".to_string(),
        event_type: "bronze.object.ready".to_string(),
        source_product_id: "mast-001".to_string(),
        sample_id: None,
        bucket: "aurora".to_string(),
        object_key: "bronze/tess/sector-0042/123/file.fits".to_string(),
        product_kind: kind,
        sector: 42,
        tic_id: Some(123456789),
        camera: Some(1),
        ccd: Some(2),
        size_bytes: 1024,
        sha256: "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899".to_string(),
        occurred_at: "2026-08-07T00:00:00Z".to_string(),
    }
}

#[test]
fn test_raw_light_curve_struct() {
    let lc = RawLightCurve {
        time: vec![1.0, 2.0, 3.0],
        sap_flux: None,
        sap_flux_err: None,
        pdcsap_flux: Some(vec![100.0, 101.0, 99.5]),
        pdcsap_flux_err: Some(vec![0.5, 0.5, 0.5]),
        quality: vec![0, 0, 0],
        tic_id: Some(123456789),
        sector: Some(42),
        camera: Some(1),
        ccd: Some(2),
    };

    assert_eq!(lc.time.len(), 3);
    assert_eq!(lc.pdcsap_flux.as_ref().unwrap().len(), 3);
    assert_eq!(lc.quality.len(), 3);
}

#[test]
fn test_raw_tpf_struct() {
    let tpf = RawTargetPixel {
        time: vec![1.0, 2.0],
        quality: vec![0, 0],
        flux: vec![
            vec![vec![1.0, 2.0], vec![3.0, 4.0]],
            vec![vec![1.1, 2.1], vec![3.1, 4.1]],
        ],
        rows: 2,
        cols: 2,
        tic_id: Some(123456789),
        sector: Some(42),
    };

    assert_eq!(tpf.time.len(), 2);
    assert_eq!(tpf.rows, 2);
    assert_eq!(tpf.cols, 2);
    assert_eq!(tpf.flux.len(), 2);
}

#[test]
fn test_raw_ffi_struct() {
    let ffi = RawFfi {
        width: 10,
        height: 10,
        pixels: vec![0.0; 100],
        sector: Some(42),
        camera: Some(1),
        ccd: Some(2),
    };

    assert_eq!(ffi.width, 10);
    assert_eq!(ffi.height, 10);
    assert_eq!(ffi.pixels.len(), 100);
}

#[test]
fn test_decoded_product_enum() {
    let event = make_event(ProductKind::LightCurve);
    let lc = RawLightCurve {
        time: vec![1.0],
        sap_flux: None,
        sap_flux_err: None,
        pdcsap_flux: Some(vec![100.0]),
        pdcsap_flux_err: Some(vec![0.5]),
        quality: vec![0],
        tic_id: event.tic_id,
        sector: Some(event.sector),
        camera: event.camera,
        ccd: event.ccd,
    };

    let product = DecodedProduct::LightCurve(lc);
    match product {
        DecodedProduct::LightCurve(val) => {
            assert_eq!(val.tic_id, Some(123456789));
        }
        _ => panic!("Expected LightCurve product variant"),
    }
}
