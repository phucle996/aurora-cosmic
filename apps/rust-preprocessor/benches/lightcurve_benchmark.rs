#[path = "alloc_tracker.rs"]
mod alloc_tracker;

use alloc_tracker::TrackingAllocator;
use criterion::{black_box, criterion_group, criterion_main, Criterion, Throughput};
use std::f32;
use tempfile::tempdir;

use aurora_preprocessor::config::LightCurveConfig;
use aurora_preprocessor::event::{BronzeObjectReady, ProductKind};
use aurora_preprocessor::fits::RawLightCurve;
use aurora_preprocessor::output::silver::serialize_lightcurve;
use aurora_preprocessor::pipeline::lightcurve::preprocess_lc;

#[global_allocator]
static TRACKER: TrackingAllocator = TrackingAllocator::new();

fn mock_lc_event() -> BronzeObjectReady {
    BronzeObjectReady {
        event_id: "bench-lc-evt-001".to_string(),
        event_type: "bronze.object.ready".to_string(),
        source_product_id: "tess2026-s0042-000261136674-s_lc".to_string(),
        sample_id: Some("sample-lc-42".to_string()),
        bucket: "aurora".to_string(),
        object_key: "bronze/tess/sector-0042/261136674/tess_lc.fits".to_string(),
        product_kind: ProductKind::LightCurve,
        sector: 42,
        tic_id: Some(261136674),
        camera: Some(1),
        ccd: Some(1),
        size_bytes: 512 * 1024,
        sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855".to_string(),
        occurred_at: "2026-08-01T00:00:00Z".to_string(),
    }
}

fn generate_synthetic_lc(n: usize) -> RawLightCurve {
    let mut time = Vec::with_capacity(n);
    let mut pdcsap = Vec::with_capacity(n);
    let mut err = Vec::with_capacity(n);
    let mut quality = Vec::with_capacity(n);

    for i in 0..n {
        let t = 100.0 + (i as f64) * 0.0013888; // 2-min cadence
        time.push(t);
        let phase = (t * 2.0 * std::f64::consts::PI / 3.5).sin() as f32;
        let transit = if (i % 2000) < 50 { -250.0 } else { 0.0 };
        let noise = ((i % 19) as f32 - 9.0) * 3.0;
        pdcsap.push(10_000.0 + phase * 50.0 + transit + noise);
        err.push(12.5);
        quality.push(if i % 400 == 0 { 128 } else { 0 }); // 0.25% quality flags
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

// Footstep 1: Quality Bitmask & Non-finite Filtering
fn footstep_1_filter(raw: &RawLightCurve) -> (Vec<f64>, Vec<f32>, Vec<f32>, Vec<i32>) {
    let n = raw.time.len();
    let pdcsap = raw.pdcsap_flux.as_ref().unwrap();
    let err = raw.pdcsap_flux_err.as_ref().unwrap();

    let mut filtered_time = Vec::with_capacity(n);
    let mut filtered_flux = Vec::with_capacity(n);
    let mut filtered_err = Vec::with_capacity(n);
    let mut filtered_qual = Vec::with_capacity(n);

    for i in 0..n {
        let t = raw.time[i];
        let f = pdcsap[i];
        let q = raw.quality[i];
        if q != 0 || !t.is_finite() || !f.is_finite() || t <= 0.0 {
            continue;
        }
        filtered_time.push(t);
        filtered_flux.push(f);
        filtered_err.push(err[i]);
        filtered_qual.push(q);
    }
    (filtered_time, filtered_flux, filtered_err, filtered_qual)
}

// Footstep 2: Time Ordering & Timestamp Deduplication
fn footstep_2_sort_dedup(
    times: &[f64],
    fluxes: &[f32],
    errs: &[f32],
    quals: &[i32],
) -> (Vec<f64>, Vec<f32>, Vec<f32>, Vec<i32>) {
    let n = times.len();
    let mut indices: Vec<usize> = (0..n).collect();
    indices.sort_by(|&a, &b| times[a].partial_cmp(&times[b]).unwrap());

    let mut sorted_time = Vec::with_capacity(n);
    let mut sorted_flux = Vec::with_capacity(n);
    let mut sorted_err = Vec::with_capacity(n);
    let mut sorted_qual = Vec::with_capacity(n);

    let mut last_t: Option<f64> = None;
    for idx in indices {
        let t = times[idx];
        if let Some(prev) = last_t {
            if (t - prev).abs() < 1e-9 {
                continue;
            }
        }
        last_t = Some(t);
        sorted_time.push(t);
        sorted_flux.push(fluxes[idx]);
        sorted_err.push(errs[idx]);
        sorted_qual.push(quals[idx]);
    }
    (sorted_time, sorted_flux, sorted_err, sorted_qual)
}

// Footstep 3: Median Calculation & Flux Normalization (Optimized O(n) Quickselect)
fn footstep_3_median_normalize(fluxes: &[f32], errs: &[f32]) -> (f32, Vec<f32>, Vec<f32>) {
    let mut scratch = fluxes.to_vec();
    let mid = scratch.len() / 2;
    scratch.select_nth_unstable_by(mid, |a, b| {
        a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal)
    });
    let median = if scratch.len().is_multiple_of(2) {
        let val_mid = scratch[mid];
        let max_left = scratch[..mid]
            .iter()
            .max_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
            .copied()
            .unwrap_or(val_mid);
        (max_left + val_mid) / 2.0
    } else {
        scratch[mid]
    };

    let norm_flux: Vec<f32> = fluxes.iter().map(|&f| (f / median) - 1.0).collect();
    let norm_err: Vec<f32> = errs.iter().map(|&e| e / median).collect();
    (median, norm_flux, norm_err)
}

// Footstep 4: 3.0-Sigma Outlier Clipping
fn footstep_4_sigma_clip(
    times: &[f64],
    fluxes: &[f32],
    errs: &[f32],
    quals: &[i32],
    sigma: f32,
) -> (Vec<f64>, Vec<f32>, Vec<f32>, Vec<i32>) {
    let n = fluxes.len();
    let mean: f32 = fluxes.iter().sum::<f32>() / n as f32;
    let variance: f32 = fluxes.iter().map(|&x| (x - mean).powi(2)).sum::<f32>() / n as f32;
    let std_dev = variance.sqrt();
    let threshold = sigma * std_dev;

    let mut keep_mask = vec![true; n];
    for (i, &f) in fluxes.iter().enumerate() {
        if f.abs() > threshold {
            keep_mask[i] = false;
        }
    }

    let out_t: Vec<f64> = times
        .iter()
        .zip(&keep_mask)
        .filter(|(_, &k)| k)
        .map(|(&t, _)| t)
        .collect();
    let out_f: Vec<f32> = fluxes
        .iter()
        .zip(&keep_mask)
        .filter(|(_, &k)| k)
        .map(|(&f, _)| f)
        .collect();
    let out_e: Vec<f32> = errs
        .iter()
        .zip(&keep_mask)
        .filter(|(_, &k)| k)
        .map(|(&e, _)| e)
        .collect();
    let out_q: Vec<i32> = quals
        .iter()
        .zip(&keep_mask)
        .filter(|(_, &k)| k)
        .map(|(&q, _)| q)
        .collect();

    (out_t, out_f, out_e, out_q)
}

fn bench_lightcurve_footsteps(c: &mut Criterion) {
    let points = 15_000;
    let raw = generate_synthetic_lc(points);
    let event = mock_lc_event();
    let tmp = tempdir().unwrap();

    let full_config = LightCurveConfig {
        min_points: 50,
        quality_mode: "strict".to_string(),
        allow_sap_fallback: false,
        sigma_clip: Some(3.0),
    };

    // Pre-calculate intermediate footstep outputs for isolated step profiling
    let (f1_t, f1_f, f1_e, f1_q) = footstep_1_filter(&raw);
    let (f2_t, f2_f, f2_e, f2_q) = footstep_2_sort_dedup(&f1_t, &f1_f, &f1_e, &f1_q);
    let (_med, f3_f, f3_e) = footstep_3_median_normalize(&f2_f, &f2_e);
    let processed_lc = preprocess_lc(raw.clone(), &event, &full_config).unwrap();

    // Measure and print exact allocation footprints for each footstep
    eprintln!("\n=================== LIGHT CURVE FOOTSTEP ALLOCATION PROFILES (15,000 points) ===================");
    let (_, diff1) = TRACKER.measure(|| footstep_1_filter(&raw));
    diff1.print("Step 1: Quality Filter");

    let (_, diff2) = TRACKER.measure(|| footstep_2_sort_dedup(&f1_t, &f1_f, &f1_e, &f1_q));
    diff2.print("Step 2: Sort & Deduplicate");

    let (_, diff3) = TRACKER.measure(|| footstep_3_median_normalize(&f2_f, &f2_e));
    diff3.print("Step 3: Median & Normalize");

    let (_, diff4) = TRACKER.measure(|| footstep_4_sigma_clip(&f2_t, &f3_f, &f3_e, &f2_q, 3.0));
    diff4.print("Step 4: Sigma Clipping 3.0σ");

    let (_, diff5) = TRACKER.measure(|| {
        serialize_lightcurve(&processed_lc, &event, tmp.path(), "sha256:bench-fp").unwrap()
    });
    diff5.print("Step 5: Parquet ZSTD Write");

    let (_, diff_full) = TRACKER.measure(|| {
        let p = preprocess_lc(raw.clone(), &event, &full_config).unwrap();
        serialize_lightcurve(&p, &event, tmp.path(), "sha256:bench-fp").unwrap()
    });
    diff_full.print("Full E2E LightCurve Pipeline");
    eprintln!("=================================================================================================\n");

    let mut group = c.benchmark_group("lightcurve_footsteps");
    group.throughput(Throughput::Elements(points as u64));

    group.bench_function("footstep_1_quality_filtering", |b| {
        b.iter(|| footstep_1_filter(black_box(&raw)))
    });

    group.bench_function("footstep_2_sort_dedup", |b| {
        b.iter(|| {
            footstep_2_sort_dedup(
                black_box(&f1_t),
                black_box(&f1_f),
                black_box(&f1_e),
                black_box(&f1_q),
            )
        })
    });

    group.bench_function("footstep_3_median_normalize", |b| {
        b.iter(|| footstep_3_median_normalize(black_box(&f2_f), black_box(&f2_e)))
    });

    group.bench_function("footstep_4_sigma_clip", |b| {
        b.iter(|| {
            footstep_4_sigma_clip(
                black_box(&f2_t),
                black_box(&f3_f),
                black_box(&f3_e),
                black_box(&f2_q),
                3.0,
            )
        })
    });

    group.bench_function("footstep_5_parquet_zstd_write", |b| {
        b.iter(|| {
            serialize_lightcurve(
                black_box(&processed_lc),
                black_box(&event),
                black_box(tmp.path()),
                "sha256:bench-fp",
            )
            .unwrap()
        })
    });

    group.bench_function("e2e_lightcurve_full_pipeline", |b| {
        b.iter(|| {
            let p = preprocess_lc(
                black_box(raw.clone()),
                black_box(&event),
                black_box(&full_config),
            )
            .unwrap();
            serialize_lightcurve(
                black_box(&p),
                black_box(&event),
                black_box(tmp.path()),
                "sha256:bench-fp",
            )
            .unwrap()
        })
    });

    group.finish();
}

criterion_group!(benches, bench_lightcurve_footsteps);
criterion_main!(benches);
