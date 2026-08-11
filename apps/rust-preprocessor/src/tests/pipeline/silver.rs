use std::fs::File;
use tempfile::tempdir;

use arrow::array::AsArray;
use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;

use crate::event::{BronzeObjectReady, ProductKind};
use crate::output::silver::{
    build_ffi_key, build_lc_key, build_tpf_key, serialize_ffi, serialize_lightcurve,
    serialize_target_pixel,
};
use crate::pipeline::image::{
    ImageProcessingMetadata, ImageStatistics, ProcessedFfi, ProcessedTargetPixel,
};
use crate::pipeline::lightcurve::{
    FluxSource, LightCurveProcessingMetadata, ProcessedLightCurve, QualityMode,
};

fn make_event(kind: ProductKind) -> BronzeObjectReady {
    BronzeObjectReady {
        event_id: "evt-001".to_string(),
        event_type: "bronze.object.ready".to_string(),
        source_product_id: "tess2021204101400-s0042-0000000123456789".to_string(),
        sample_id: None,
        bucket: "aurora".to_string(),
        object_key: "bronze/tess/lightcurve/sector=0042/tic=123456789/lc.fits".to_string(),
        product_kind: kind,
        sector: 42,
        tic_id: Some(123456789),
        camera: Some(1),
        ccd: Some(2),
        size_bytes: 1024,
        sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef".to_string(),
        occurred_at: "2026-08-07T00:00:00Z".to_string(),
    }
}

#[test]
fn test_build_deterministic_keys() {
    let lc_key = build_lc_key(42, Some(123456789), "prod-1", "v1");
    assert_eq!(
        lc_key,
        "silver/tess/lightcurve/processor=v1/sector=0042/tic=123456789/prod-1.parquet"
    );

    let tpf_key = build_tpf_key(42, Some(123456789), "prod-1", "v1");
    assert_eq!(
        tpf_key,
        "silver/tess/target-pixel/processor=v1/sector=0042/tic=123456789/prod-1.parquet"
    );

    let ffi_key = build_ffi_key(42, Some(1), Some(2), "prod-1", "v1");
    assert_eq!(
        ffi_key,
        "silver/tess/ffi/processor=v1/sector=0042/camera=1/ccd=2/prod-1.parquet"
    );
}

#[test]
fn test_processor_version_changes_path() {
    let key_v1 = build_lc_key(42, Some(123456789), "prod-1", "lc-preprocess-v1");
    let key_v2 = build_lc_key(42, Some(123456789), "prod-1", "lc-preprocess-v2");

    assert_ne!(key_v1, key_v2);
    assert!(key_v1.contains("processor=lc-preprocess-v1"));
    assert!(key_v2.contains("processor=lc-preprocess-v2"));
}

#[test]
fn test_serialize_lightcurve_parquet_roundtrip() {
    let dir = tempdir().unwrap();
    let event = make_event(ProductKind::LightCurve);

    let lc = ProcessedLightCurve {
        time: vec![100.0, 100.02, 100.04],
        flux: vec![0.0, -0.01, 0.005],
        flux_err: Some(vec![0.001, 0.001, 0.001]),
        quality: vec![0, 0, 0],
        tic_id: Some(123456789),
        processing: LightCurveProcessingMetadata {
            processor_version: "lc-preprocess-v1".to_string(),
            flux_source: FluxSource::Pdcsap,
            quality_mode: QualityMode::Strict,
            input_points: 3,
            output_points: 3,
            quality_removed: 0,
            invalid_removed: 0,
            outlier_removed: 0,
            flux_median: 1000.0,
        },
    };

    let artifact = serialize_lightcurve(&lc, &event, dir.path()).unwrap();
    assert_eq!(artifact.schema_version, "silver-lightcurve-v1");
    assert!(artifact.size_bytes > 0);
    assert_eq!(artifact.sha256.len(), 64);

    // Read back Parquet file
    let file = File::open(&artifact.local_path).unwrap();
    let builder = ParquetRecordBatchReaderBuilder::try_new(file).unwrap();
    let mut reader = builder.build().unwrap();

    let batch = reader.next().unwrap().unwrap();
    assert_eq!(batch.num_rows(), 3);
    assert_eq!(batch.num_columns(), 4);

    let times = batch
        .column(0)
        .as_primitive::<arrow::datatypes::Float64Type>();
    let fluxes = batch
        .column(1)
        .as_primitive::<arrow::datatypes::Float32Type>();
    let errs = batch
        .column(2)
        .as_primitive::<arrow::datatypes::Float32Type>();
    let quals = batch
        .column(3)
        .as_primitive::<arrow::datatypes::Int32Type>();

    assert_eq!(times.value(0), 100.0);
    assert!((fluxes.value(1) - (-0.01)).abs() < 1e-5);
    assert!((errs.value(0) - 0.001).abs() < 1e-5);
    assert_eq!(quals.value(0), 0);
}

#[test]
fn test_serialize_target_pixel_parquet_roundtrip() {
    let dir = tempdir().unwrap();
    let event = make_event(ProductKind::TargetPixel);

    let tpf = ProcessedTargetPixel {
        time: vec![1.0, 2.0],
        quality: vec![0, 0],
        flux: vec![
            vec![vec![0.0, 0.1], vec![0.2, 0.3]],
            vec![vec![0.0, 0.1], vec![0.2, 0.3]],
        ],
        rows: 2,
        cols: 2,
        tic_id: Some(123456789),
        processing: ImageProcessingMetadata {
            processor_version: "tpf-preprocess-v1".to_string(),
            normalization_mode: "temporal-median".to_string(),
            input_cadences: 2,
            output_cadences: 2,
            quality_removed: 0,
            invalid_time_removed: 0,
            finite_pixel_fraction: 1.0,
        },
    };

    let artifact = serialize_target_pixel(&tpf, &event, dir.path()).unwrap();
    assert_eq!(artifact.schema_version, "silver-target-pixel-v1");
    assert!(artifact.size_bytes > 0);

    let file = File::open(&artifact.local_path).unwrap();
    let builder = ParquetRecordBatchReaderBuilder::try_new(file).unwrap();
    let mut reader = builder.build().unwrap();

    let batch = reader.next().unwrap().unwrap();
    assert_eq!(batch.num_rows(), 2);
    assert_eq!(batch.num_columns(), 5);

    let rows_col = batch
        .column(3)
        .as_primitive::<arrow::datatypes::Int32Type>();
    let cols_col = batch
        .column(4)
        .as_primitive::<arrow::datatypes::Int32Type>();
    assert_eq!(rows_col.value(0), 2);
    assert_eq!(cols_col.value(0), 2);
}

#[test]
fn test_serialize_ffi_parquet_roundtrip() {
    let dir = tempdir().unwrap();
    let event = make_event(ProductKind::Ffi);

    let ffi = ProcessedFfi {
        width: 10,
        height: 10,
        statistics: ImageStatistics {
            width: 10,
            height: 10,
            finite_pixel_count: 100,
            finite_pixel_fraction: 1.0,
            median: 50.0,
            mean: 50.0,
            stddev: 10.0,
            min: 0.0,
            max: 100.0,
        },
        cutouts: Vec::new(),
        processing: ImageProcessingMetadata {
            processor_version: "ffi-preprocess-v1".to_string(),
            normalization_mode: "median".to_string(),
            input_cadences: 1,
            output_cadences: 1,
            quality_removed: 0,
            invalid_time_removed: 0,
            finite_pixel_fraction: 1.0,
        },
    };

    let artifact = serialize_ffi(&ffi, &event, dir.path()).unwrap();
    assert_eq!(artifact.schema_version, "silver-ffi-v1");
    assert!(artifact.size_bytes > 0);

    let file = File::open(&artifact.local_path).unwrap();
    let builder = ParquetRecordBatchReaderBuilder::try_new(file).unwrap();
    let mut reader = builder.build().unwrap();

    let batch = reader.next().unwrap().unwrap();
    assert_eq!(batch.num_rows(), 1);
    assert_eq!(batch.num_columns(), 9);

    let width_col = batch
        .column(0)
        .as_primitive::<arrow::datatypes::Int32Type>();
    assert_eq!(width_col.value(0), 10);
}
