use criterion::{black_box, criterion_group, criterion_main, Criterion, Throughput};
use sha2::{Digest, Sha256};
use tempfile::tempdir;

use aurora_preprocessor::config::{ImageConfig, LightCurveConfig};
use aurora_preprocessor::event::{BronzeObjectReady, ProductKind};
use aurora_preprocessor::fits::{RawLightCurve, RawTargetPixel};
use aurora_preprocessor::output::silver::{build_lc_key, build_tpf_key, serialize_lightcurve};
use aurora_preprocessor::pipeline::lightcurve::preprocess_lc;
use aurora_preprocessor::pipeline::target_pixel::preprocess_target_pixel;

fn mock_bronze_event(kind: ProductKind) -> BronzeObjectReady {
    BronzeObjectReady {
        event_id: "bench-event-001".to_string(),
        event_type: "bronze.object.ready".to_string(),
        source_product_id: "tess2026-s0042-bench".to_string(),
        sample_id: Some("sample-42".to_string()),
        bucket: "aurora".to_string(),
        object_key: "bronze/tess/sector-0042/bench-product.fits".to_string(),
        product_kind: kind,
        sector: 42,
        tic_id: Some(261136674),
        camera: Some(1),
        ccd: Some(1),
        size_bytes: 1024 * 1024,
        sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855".to_string(),
        occurred_at: "2026-08-01T00:00:00Z".to_string(),
    }
}

fn generate_raw_lc(n: usize) -> RawLightCurve {
    let mut time = Vec::with_capacity(n);
    let mut pdcsap = Vec::with_capacity(n);
    let mut err = Vec::with_capacity(n);
    let mut quality = Vec::with_capacity(n);

    for i in 0..n {
        let t = 100.0 + (i as f64) * 0.001388; // ~2 min cadence in days
        time.push(t);
        // Base flux with sinusoidal variation and periodic transit dip + gaussian-ish noise
        let phase = (t * 2.0 * std::f64::consts::PI / 3.5).sin() as f32;
        let transit = if (i % 2000) < 50 { -200.0 } else { 0.0 };
        let noise = ((i % 17) as f32 - 8.0) * 2.5;
        pdcsap.push(10_000.0 + phase * 50.0 + transit + noise);
        err.push(12.5);
        quality.push(if i % 500 == 0 { 128 } else { 0 }); // 0.2% flagged
    }

    RawLightCurve {
        time,
        sap_flux: None,
        sap_flux_err: None,
        pdcsap_flux: Some(pdcsap),
        pdcsap_flux_err: Some(err),
        quality,
        tic_id: Some(261136674),
    }
}

fn generate_raw_tpf(cadences: usize, rows: usize, cols: usize) -> RawTargetPixel {
    let mut time = Vec::with_capacity(cadences);
    let mut quality = Vec::with_capacity(cadences);
    let mut flux = Vec::with_capacity(cadences);

    for c in 0..cadences {
        time.push(100.0 + (c as f64) * 0.001388);
        quality.push(if c % 300 == 0 { 32 } else { 0 });

        let mut frame = Vec::with_capacity(rows);
        for r in 0..rows {
            let mut row_pixels = Vec::with_capacity(cols);
            for col in 0..cols {
                let dist_sq = (r as f32 - rows as f32 / 2.0).powi(2)
                    + (col as f32 - cols as f32 / 2.0).powi(2);
                let psf = (-dist_sq / 4.0).exp() * 5000.0;
                let bg = 120.0 + ((r + col + c % 10) as f32);
                row_pixels.push(psf + bg);
            }
            frame.push(row_pixels);
        }
        flux.push(frame);
    }

    RawTargetPixel {
        time,
        quality,
        flux,
        rows,
        cols,
        tic_id: Some(261136674),
    }
}

fn bench_lightcurve_pipeline(c: &mut Criterion) {
    let mut group = c.benchmark_group("pipeline_lightcurve");
    let event = mock_bronze_event(ProductKind::LightCurve);

    // Standard 2-minute cadence: ~15,000 cadences per TESS sector
    let points = 15_000;
    group.throughput(Throughput::Elements(points as u64));

    let nominal_config = LightCurveConfig {
        min_points: 50,
        quality_mode: "strict".to_string(),
        allow_sap_fallback: false,
        sigma_clip: None,
    };

    let sigma_clip_config = LightCurveConfig {
        min_points: 50,
        quality_mode: "strict".to_string(),
        allow_sap_fallback: false,
        sigma_clip: Some(3.0),
    };

    let raw = generate_raw_lc(points);

    group.bench_function("preprocess_lc_nominal_15k", |b| {
        b.iter(|| {
            preprocess_lc(
                black_box(raw.clone()),
                black_box(&event),
                black_box(&nominal_config),
            )
            .unwrap()
        })
    });

    group.bench_function("preprocess_lc_sigma_clip_15k", |b| {
        b.iter(|| {
            preprocess_lc(
                black_box(raw.clone()),
                black_box(&event),
                black_box(&sigma_clip_config),
            )
            .unwrap()
        })
    });

    group.finish();
}

fn bench_target_pixel_pipeline(c: &mut Criterion) {
    let mut group = c.benchmark_group("pipeline_target_pixel");
    let event = mock_bronze_event(ProductKind::TargetPixel);

    // 11x11 pixel postage stamp across 1,000 cadences (~121,000 pixel values)
    let cadences = 1_000;
    let rows = 11;
    let cols = 11;
    let total_pixels = cadences * rows * cols;
    group.throughput(Throughput::Elements(total_pixels as u64));

    let config = ImageConfig {
        tpf_quality_mode: "strict".to_string(),
        tpf_normalization: "temporal-median".to_string(),
        tpf_chunk_cadences: 500,
    };

    let raw_tpf = generate_raw_tpf(cadences, rows, cols);

    group.bench_function("preprocess_tpf_11x11_1k_cadences", |b| {
        b.iter(|| {
            preprocess_target_pixel(
                black_box(raw_tpf.clone()),
                black_box(&event),
                black_box(&config),
            )
            .unwrap()
        })
    });

    group.finish();
}

fn bench_silver_serialization(c: &mut Criterion) {
    let mut group = c.benchmark_group("silver_serialization");
    let event = mock_bronze_event(ProductKind::LightCurve);
    let tmp = tempdir().unwrap();

    let nominal_config = LightCurveConfig {
        min_points: 50,
        quality_mode: "strict".to_string(),
        allow_sap_fallback: false,
        sigma_clip: None,
    };
    let raw = generate_raw_lc(15_000);
    let processed_lc = preprocess_lc(raw, &event, &nominal_config).unwrap();

    group.throughput(Throughput::Elements(15_000));
    group.bench_function("serialize_lc_parquet_zstd_15k", |b| {
        b.iter(|| {
            serialize_lightcurve(
                black_box(&processed_lc),
                black_box(&event),
                black_box(tmp.path()),
                black_box("sha256:config-fingerprint-test"),
            )
            .unwrap()
        })
    });

    group.finish();
}

fn bench_hashing_and_keys(c: &mut Criterion) {
    let mut group = c.benchmark_group("hashing_and_keys");

    // Benchmark 1MB payload SHA-256 (typical FITS block / staging verification)
    let payload = vec![0x5au8; 1024 * 1024];
    group.throughput(Throughput::Bytes(payload.len() as u64));
    group.bench_function("sha256_1mb_payload", |b| {
        b.iter(|| {
            let mut hasher = Sha256::new();
            hasher.update(black_box(&payload));
            hasher.finalize()
        })
    });

    // Benchmark deterministic key creation
    group.bench_function("build_silver_keys", |b| {
        b.iter(|| {
            let lc_key = build_lc_key(
                black_box(42),
                black_box(Some(261136674)),
                black_box("tess2026-s0042-000261136674-s_lc"),
                black_box("v1.0.0"),
                black_box("fp-config-abc"),
            );
            let tpf_key = build_tpf_key(
                black_box(42),
                black_box(Some(261136674)),
                black_box("tess2026-s0042-000261136674-s_tp"),
                black_box("v1.0.0"),
                black_box("fp-config-abc"),
            );
            (lc_key, tpf_key)
        })
    });

    group.finish();
}

criterion_group!(
    benches,
    bench_lightcurve_pipeline,
    bench_target_pixel_pipeline,
    bench_silver_serialization,
    bench_hashing_and_keys,
);
criterion_main!(benches);
