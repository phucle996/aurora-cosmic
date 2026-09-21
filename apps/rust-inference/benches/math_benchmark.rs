#[path = "common/alloc_tracker.rs"]
mod alloc_tracker;

use alloc_tracker::TrackingAllocator;
use criterion::{black_box, criterion_group, criterion_main, Criterion, Throughput};

use aurora_inference::job::{compute_job_fingerprint, JobFingerprintInput};
use aurora_inference::prediction::{compute_candidate_prediction_id, compute_model_input_sha256};
use aurora_inference::runtime::stable_sigmoid;

#[global_allocator]
static TRACKER: TrackingAllocator = TrackingAllocator::new();

fn bench_stable_sigmoid(c: &mut Criterion) {
    let mut group = c.benchmark_group("math_stable_sigmoid");
    group.throughput(Throughput::Elements(1));

    let logits = [-150.0, -5.0, -1.0, 0.0, 1.0, 5.0, 150.0];
    for &logit in &logits {
        group.bench_function(format!("logit_{:+0.1}", logit), |b| {
            b.iter(|| stable_sigmoid(black_box(logit)))
        });
    }
    group.finish();
}

fn bench_model_input_sha256(c: &mut Criterion) {
    let mut group = c.benchmark_group("crypto_model_input_sha256");

    for &dim in &[16, 64, 128, 256] {
        let features: Vec<f32> = (0..dim).map(|i| (i as f32) * 0.1 - 1.0).collect();
        group.throughput(Throughput::Bytes((dim * std::mem::size_of::<f32>()) as u64));

        let (_, diff) = TRACKER.measure(|| {
            compute_model_input_sha256(&features);
        });
        diff.print(&format!("model_input_sha256_{}dim", dim));

        group.bench_function(format!("dim_{}", dim), |b| {
            b.iter(|| compute_model_input_sha256(black_box(&features)))
        });
    }
    group.finish();
}

fn bench_prediction_id_and_fingerprint(c: &mut Criterion) {
    let mut group = c.benchmark_group("crypto_prediction_identity");
    group.throughput(Throughput::Elements(1));

    let (_, diff) = TRACKER.measure(|| {
        compute_candidate_prediction_id(
            "runtime-v1-pkg-001",
            "gold-v1-snapshot-42",
            "tess-s0042-000261136674",
        );
    });
    diff.print("candidate_prediction_id");

    group.bench_function("compute_candidate_prediction_id", |b| {
        b.iter(|| {
            compute_candidate_prediction_id(
                black_box("runtime-v1-pkg-001"),
                black_box("gold-v1-snapshot-42"),
                black_box("tess-s0042-000261136674"),
            )
        })
    });

    let input = JobFingerprintInput {
        task: "candidate_vetting",
        selection_policy_version: "candidate-inference-selection-v1",
        gold_snapshot_id: "gold-v1-snapshot-42",
        gold_manifest_sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        gold_artifact_key: "gold/candidate/part-00000.parquet",
        gold_artifact_content_sha256:
            "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        runtime_package_id: "runtime-v1-pkg-001",
        runtime_manifest_sha256: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        runtime_validation_id: "rval-v1-001",
    };

    let (_, diff) = TRACKER.measure(|| {
        compute_job_fingerprint(&input);
    });
    diff.print("job_fingerprint");

    group.bench_function("compute_job_fingerprint", |b| {
        b.iter(|| compute_job_fingerprint(black_box(&input)))
    });

    group.finish();
}

criterion_group!(
    benches,
    bench_stable_sigmoid,
    bench_model_input_sha256,
    bench_prediction_id_and_fingerprint
);
criterion_main!(benches);
