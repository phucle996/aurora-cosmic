#[path = "common/alloc_tracker.rs"]
mod alloc_tracker;

use alloc_tracker::TrackingAllocator;
use criterion::{black_box, criterion_group, criterion_main, Criterion, Throughput};
use std::sync::Arc;

use arrow_array::{ArrayRef, Float64Array, Int64Array, RecordBatch, StringArray};
use arrow_schema::{DataType, Field, Schema};
use aurora_inference::adapters::gold::decode_gold_batch;

#[global_allocator]
static TRACKER: TrackingAllocator = TrackingAllocator::new();

fn create_synthetic_gold_batch(num_rows: usize, num_features: usize) -> (RecordBatch, Vec<String>) {
    let mut fields = vec![
        Field::new("source_product_id", DataType::Utf8, false),
        Field::new("tic_id", DataType::Int64, false),
        Field::new("sector", DataType::Int64, false),
        Field::new("sample_id", DataType::Utf8, true),
    ];
    let mut feature_names = Vec::with_capacity(num_features);
    for i in 0..num_features {
        let name = format!("feat_{:02}", i);
        fields.push(Field::new(&name, DataType::Float64, true));
        feature_names.push(name);
    }
    let schema = Arc::new(Schema::new(fields));

    let sources: Vec<String> = (0..num_rows)
        .map(|i| format!("tess2026-s0042-{:08}-s_lc", i))
        .collect();
    let source_refs: Vec<&str> = sources.iter().map(|s| s.as_str()).collect();
    let tics: Vec<i64> = (0..num_rows).map(|i| 261130000 + i as i64).collect();
    let sectors: Vec<i64> = vec![42; num_rows];
    let samples: Vec<Option<&str>> = (0..num_rows)
        .map(|i| if i % 2 == 0 { Some("sample-42") } else { None })
        .collect();

    let mut columns: Vec<ArrayRef> = vec![
        Arc::new(StringArray::from(source_refs)),
        Arc::new(Int64Array::from(tics)),
        Arc::new(Int64Array::from(sectors)),
        Arc::new(StringArray::from(samples)),
    ];

    for i in 0..num_features {
        let values: Vec<Option<f64>> = (0..num_rows)
            .map(|row| {
                if (row + i) % 7 == 0 {
                    None
                } else {
                    Some(100.0 + (row as f64) * 0.1 + (i as f64))
                }
            })
            .collect();
        columns.push(Arc::new(Float64Array::from(values)));
    }

    let batch = RecordBatch::try_new(schema, columns).unwrap();
    (batch, feature_names)
}

fn bench_gold_batch_decoding(c: &mut Criterion) {
    let mut group = c.benchmark_group("gold_parquet_record_decoding");

    for &num_rows in &[256, 1024, 4096] {
        let (batch, feature_names) = create_synthetic_gold_batch(num_rows, 20);
        group.throughput(Throughput::Elements(num_rows as u64));

        let (_, diff) =
            TRACKER.measure(|| decode_gold_batch(batch.clone(), &feature_names).unwrap());
        diff.print(&format!("decode_gold_batch_{}_rows", num_rows));

        group.bench_function(format!("batch_{}_rows_20_features", num_rows), |b| {
            b.iter(|| {
                decode_gold_batch(black_box(batch.clone()), black_box(&feature_names)).unwrap()
            })
        });
    }
    group.finish();
}

criterion_group!(benches, bench_gold_batch_decoding);
criterion_main!(benches);
