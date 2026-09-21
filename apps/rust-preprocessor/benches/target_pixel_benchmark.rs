#[path = "alloc_tracker.rs"]
mod alloc_tracker;

use alloc_tracker::TrackingAllocator;
use criterion::{black_box, criterion_group, criterion_main, Criterion, Throughput};
use tempfile::tempdir;

use aurora_preprocessor::config::ImageConfig;
use aurora_preprocessor::event::{BronzeObjectReady, ProductKind};
use aurora_preprocessor::fits::RawTargetPixel;
use aurora_preprocessor::output::silver::TargetPixelStreamWriter;
use aurora_preprocessor::pipeline::target_pixel::preprocess_target_pixel;

#[global_allocator]
static TRACKER: TrackingAllocator = TrackingAllocator::new();

fn mock_tpf_event() -> BronzeObjectReady {
    BronzeObjectReady {
        event_id: "bench-tpf-evt-001".to_string(),
        event_type: "bronze.object.ready".to_string(),
        source_product_id: "tess2026-s0042-000261136674-s_tp".to_string(),
        sample_id: Some("sample-tpf-42".to_string()),
        bucket: "aurora".to_string(),
        object_key: "bronze/tess/sector-0042/261136674/tess_tp.fits".to_string(),
        product_kind: ProductKind::TargetPixel,
        sector: 42,
        tic_id: Some(261136674),
        camera: Some(1),
        ccd: Some(1),
        size_bytes: 4 * 1024 * 1024,
        sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855".to_string(),
        occurred_at: "2026-08-01T00:00:00Z".to_string(),
    }
}

fn generate_synthetic_tpf(cadences: usize, rows: usize, cols: usize) -> RawTargetPixel {
    let mut time = Vec::with_capacity(cadences);
    let mut quality = Vec::with_capacity(cadences);
    let mut flux = Vec::with_capacity(cadences);

    for c in 0..cadences {
        time.push(100.0 + (c as f64) * 0.0013888);
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

// Footstep 1: Time Validity and Quality Flag Masking
fn footstep_1_filter_cadences(raw: &RawTargetPixel) -> Vec<usize> {
    let mut retained = Vec::with_capacity(raw.time.len());
    for (i, &t) in raw.time.iter().enumerate() {
        let q = raw.quality.get(i).copied().unwrap_or(0);
        if q == 0 && t.is_finite() && t > 0.0 {
            retained.push(i);
        }
    }
    retained
}

// Footstep 2: Compute Pixel Temporal Medians Across Retained Cadences
#[allow(clippy::needless_range_loop)]
fn footstep_2_pixel_medians(raw: &RawTargetPixel, retained_indices: &[usize]) -> Vec<Vec<f32>> {
    let rows = raw.rows;
    let cols = raw.cols;
    let mut medians = vec![vec![0.0f32; cols]; rows];

    for r in 0..rows {
        for c in 0..cols {
            let mut series: Vec<f32> = Vec::with_capacity(retained_indices.len());
            for &idx in retained_indices {
                if idx < raw.flux.len() && r < raw.flux[idx].len() && c < raw.flux[idx][r].len() {
                    let p = raw.flux[idx][r][c];
                    if p.is_finite() {
                        series.push(p);
                    }
                }
            }
            if !series.is_empty() {
                let mid = series.len() / 2;
                series.select_nth_unstable_by(mid, |a, b| {
                    a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal)
                });
                medians[r][c] = series[mid];
            }
        }
    }
    medians
}

// Footstep 3: 3D Grid Normalization (flux / reference - 1.0)
#[allow(clippy::needless_range_loop)]
fn footstep_3_normalize_grid(
    raw: &RawTargetPixel,
    retained_indices: &[usize],
    medians: &[Vec<f32>],
) -> Vec<Vec<Vec<f32>>> {
    let mut norm_flux = Vec::with_capacity(retained_indices.len());
    for &idx in retained_indices {
        let mut frame = Vec::with_capacity(raw.rows);
        for r in 0..raw.rows {
            let mut row = Vec::with_capacity(raw.cols);
            for c in 0..raw.cols {
                let p = raw.flux[idx][r][c];
                let ref_val = medians[r][c];
                if p.is_finite() && ref_val.is_finite() && ref_val > 0.0 {
                    row.push((p / ref_val) - 1.0);
                } else {
                    row.push(0.0);
                }
            }
            frame.push(row);
        }
        norm_flux.push(frame);
    }
    norm_flux
}

// Footstep 4: Drift and Spatial Scatter Metrics (In-place slice quickselect)
#[allow(clippy::needless_range_loop)]
fn footstep_4_drift_metrics(
    raw: &RawTargetPixel,
    retained_indices: &[usize],
    medians: &[Vec<f32>],
) -> Vec<f32> {
    let rows = raw.rows;
    let cols = raw.cols;
    let mut drifts = Vec::with_capacity(rows * cols);

    for r in 0..rows {
        for c in 0..cols {
            let mut series = Vec::with_capacity(retained_indices.len());
            for &idx in retained_indices {
                series.push(raw.flux[idx][r][c]);
            }
            if series.len() >= 2 {
                let mid = series.len() / 2;
                let (h1, h2) = series.split_at_mut(mid);
                let mid1 = h1.len() / 2;
                let mid2 = h2.len() / 2;
                h1.select_nth_unstable_by(mid1, |a, b| {
                    a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal)
                });
                h2.select_nth_unstable_by(mid2, |a, b| {
                    a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal)
                });
                let m1 = h1[mid1];
                let m2 = h2[mid2];
                let ref_val = medians[r][c];
                if ref_val > 0.0 {
                    drifts.push(((m2 - m1).abs() / ref_val) * 1_000_000.0);
                }
            }
        }
    }
    drifts
}

fn bench_target_pixel_footsteps(c: &mut Criterion) {
    let cadences = 1_000;
    let rows = 11;
    let cols = 11;
    let total_pixels = cadences * rows * cols;

    let raw = generate_synthetic_tpf(cadences, rows, cols);
    let event = mock_tpf_event();
    let tmp = tempdir().unwrap();

    let config = ImageConfig {
        tpf_quality_mode: "strict".to_string(),
        tpf_normalization: "temporal-median".to_string(),
        tpf_chunk_cadences: 500,
    };

    // Pre-calculate intermediate footstep outputs
    let retained = footstep_1_filter_cadences(&raw);
    let medians = footstep_2_pixel_medians(&raw, &retained);
    let processed_tpf = preprocess_target_pixel(raw.clone(), &event, &config).unwrap();

    // Measure and print exact allocation footprints for each footstep
    eprintln!("\n=================== TARGET PIXEL FOOTSTEP ALLOCATION PROFILES (11x11, 1k cadences) ===================");
    let (_, diff1) = TRACKER.measure(|| footstep_1_filter_cadences(&raw));
    diff1.print("Step 1: Quality Filter");

    let (_, diff2) = TRACKER.measure(|| footstep_2_pixel_medians(&raw, &retained));
    diff2.print("Step 2: Temporal Median Calc");

    let (_, diff3) = TRACKER.measure(|| footstep_3_normalize_grid(&raw, &retained, &medians));
    diff3.print("Step 3: 3D Grid Normalization");

    let (_, diff4) = TRACKER.measure(|| footstep_4_drift_metrics(&raw, &retained, &medians));
    diff4.print("Step 4: Spatial Drift Metrics");

    let (_, diff5) = TRACKER.measure(|| {
        let mut writer = TargetPixelStreamWriter::new(tmp.path()).unwrap();
        writer.write_chunk(&processed_tpf).unwrap();
        writer
            .finish(
                &event,
                event.tic_id,
                processed_tpf.processing.clone(),
                1,
                500,
                "sha256:bench-tpf-fp",
            )
            .unwrap()
    });
    diff5.print("Step 5: Parquet Chunk Write");

    let (_, diff_full) = TRACKER.measure(|| {
        let p = preprocess_target_pixel(raw.clone(), &event, &config).unwrap();
        let mut writer = TargetPixelStreamWriter::new(tmp.path()).unwrap();
        writer.write_chunk(&p).unwrap();
        writer
            .finish(
                &event,
                event.tic_id,
                p.processing.clone(),
                1,
                500,
                "sha256:bench-tpf-fp",
            )
            .unwrap()
    });
    diff_full.print("Full E2E TargetPixel Pipeline");
    eprintln!("=======================================================================================================\n");

    let mut group = c.benchmark_group("target_pixel_footsteps");
    group.throughput(Throughput::Elements(total_pixels as u64));

    group.bench_function("footstep_1_quality_masking", |b| {
        b.iter(|| footstep_1_filter_cadences(black_box(&raw)))
    });

    group.bench_function("footstep_2_temporal_median", |b| {
        b.iter(|| footstep_2_pixel_medians(black_box(&raw), black_box(&retained)))
    });

    group.bench_function("footstep_3_grid_normalization", |b| {
        b.iter(|| {
            footstep_3_normalize_grid(black_box(&raw), black_box(&retained), black_box(&medians))
        })
    });

    group.bench_function("footstep_4_drift_metrics", |b| {
        b.iter(|| {
            footstep_4_drift_metrics(black_box(&raw), black_box(&retained), black_box(&medians))
        })
    });

    group.bench_function("footstep_5_parquet_stream_writer", |b| {
        b.iter(|| {
            let mut writer = TargetPixelStreamWriter::new(black_box(tmp.path())).unwrap();
            writer.write_chunk(black_box(&processed_tpf)).unwrap();
            writer
                .finish(
                    black_box(&event),
                    black_box(event.tic_id),
                    black_box(processed_tpf.processing.clone()),
                    1,
                    500,
                    black_box("sha256:bench-tpf-fp"),
                )
                .unwrap()
        })
    });

    group.bench_function("e2e_target_pixel_full_pipeline", |b| {
        b.iter(|| {
            let p = preprocess_target_pixel(
                black_box(raw.clone()),
                black_box(&event),
                black_box(&config),
            )
            .unwrap();
            let mut writer = TargetPixelStreamWriter::new(black_box(tmp.path())).unwrap();
            writer.write_chunk(black_box(&p)).unwrap();
            writer
                .finish(
                    black_box(&event),
                    black_box(event.tic_id),
                    black_box(p.processing.clone()),
                    1,
                    500,
                    black_box("sha256:bench-tpf-fp"),
                )
                .unwrap()
        })
    });

    group.finish();
}

criterion_group!(benches, bench_target_pixel_footsteps);
criterion_main!(benches);
