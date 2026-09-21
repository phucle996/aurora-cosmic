#[path = "common/alloc_tracker.rs"]
mod alloc_tracker;

use alloc_tracker::TrackingAllocator;
use criterion::{black_box, criterion_group, criterion_main, Criterion, Throughput};
use std::io::Write;

use aurora_inference::prediction::CandidatePredictionRecord;

#[global_allocator]
static TRACKER: TrackingAllocator = TrackingAllocator::new();

fn create_sample_prediction(i: usize) -> CandidatePredictionRecord {
    CandidatePredictionRecord {
        schema_version: 1,
        prediction_id: format!("pred-cand-v1-test-{:08}", i),
        prediction_fingerprint: "a".repeat(64),
        task: "candidate_vetting".to_string(),
        job_id: "inference-job-v1-0000000000000001".to_string(),
        gold_snapshot_id: "gold-v1-snapshot-42".to_string(),
        gold_artifact_key: "gold/candidate/part-00000.parquet".to_string(),
        source_product_id: format!("tess2026-s0042-{:08}-s_lc", i),
        tic_id: 261136674 + i as i64,
        sample_id: Some("sample-42".to_string()),
        sector: 42,
        runtime_package_id: "runtime-v1-pkg-001".to_string(),
        runtime_validation_id: "rval-v1-001".to_string(),
        registered_model_id: "m-candidate-v1".to_string(),
        evaluation_run_id: "eval-v1-001".to_string(),
        dataset_view_version: "gold-v1".to_string(),
        model_input_sha256: "b".repeat(64),
        raw_logit: 2.345,
        candidate_score: 0.9125,
        score_definition_version: "candidate-sigmoid-score-v1".to_string(),
        decision_threshold: 0.5,
        above_threshold: true,
        predicted_at: "2026-09-21T16:00:00Z".to_string(),
        producer: "rust-inference".to_string(),
    }
}

fn bench_prediction_serialization(c: &mut Criterion) {
    let mut group = c.benchmark_group("prediction_ndjson_serialization");

    for &batch_size in &[500, 2000] {
        let records: Vec<CandidatePredictionRecord> =
            (0..batch_size).map(create_sample_prediction).collect();

        // Calculate approximate serialized payload size
        let sample_json = serde_json::to_vec(&records[0]).unwrap();
        let estimated_bytes = (sample_json.len() + 1) * batch_size;
        group.throughput(Throughput::Bytes(estimated_bytes as u64));

        let (_, diff) = TRACKER.measure(|| {
            let mut buf =
                std::io::BufWriter::with_capacity(128 * 1024, Vec::with_capacity(estimated_bytes));
            for record in &records {
                serde_json::to_writer(&mut buf, record).unwrap();
                buf.write_all(b"\n").unwrap();
            }
            buf.flush().unwrap();
        });
        diff.print(&format!("serialize_{}_ndjson_records", batch_size));

        group.bench_function(format!("batch_{}_records", batch_size), |b| {
            b.iter(|| {
                let mut buf = std::io::BufWriter::with_capacity(
                    128 * 1024,
                    Vec::with_capacity(estimated_bytes),
                );
                for record in black_box(&records) {
                    serde_json::to_writer(&mut buf, record).unwrap();
                    buf.write_all(b"\n").unwrap();
                }
                buf.flush().unwrap();
                black_box(buf.into_inner().unwrap());
            })
        });
    }
    group.finish();
}

criterion_group!(benches, bench_prediction_serialization);
criterion_main!(benches);
