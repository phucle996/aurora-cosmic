#[path = "common/alloc_tracker.rs"]
mod alloc_tracker;

use alloc_tracker::TrackingAllocator;
use criterion::{black_box, criterion_group, criterion_main, Criterion, Throughput};
use std::collections::HashMap;

use aurora_inference::model::PreprocessingConfig;
use aurora_inference::runtime::preprocess_features;

#[global_allocator]
static TRACKER: TrackingAllocator = TrackingAllocator::new();

fn build_feature_environment(
    num_features: usize,
    null_ratio: f64,
) -> (
    Vec<String>,
    HashMap<String, Option<f64>>,
    PreprocessingConfig,
) {
    let mut feature_order = Vec::with_capacity(num_features);
    let mut raw_features = HashMap::with_capacity(num_features);
    let mut feature_means = HashMap::with_capacity(num_features);
    let mut feature_scales = HashMap::with_capacity(num_features);
    let mut feature_medians = HashMap::with_capacity(num_features);

    for i in 0..num_features {
        let name = format!("feature_{:03}", i);
        let is_null = (i as f64 / num_features as f64) < null_ratio;
        let value = if is_null {
            None
        } else {
            Some(10.0 + (i as f64) * 0.5)
        };

        feature_order.push(name.clone());
        raw_features.insert(name.clone(), value);
        feature_means.insert(name.clone(), 10.0);
        feature_scales.insert(name.clone(), 2.5);
        feature_medians.insert(name, 11.2);
    }

    let config = PreprocessingConfig {
        schema_version: 1,
        preprocessing_version: "prep-v1".to_string(),
        split_id: "split-v1".to_string(),
        feature_order: feature_order.clone(),
        feature_means,
        feature_scales,
        feature_medians,
        label_encoding: HashMap::new(),
    };

    (feature_order, raw_features, config)
}

fn bench_preprocess_features_dense(c: &mut Criterion) {
    let mut group = c.benchmark_group("preprocessing_dense");

    for &num_features in &[15, 30, 60] {
        let (feature_order, raw_features, config) = build_feature_environment(num_features, 0.0);
        group.throughput(Throughput::Elements(1));

        let (_, diff) = TRACKER
            .measure(|| preprocess_features(&raw_features, &feature_order, &config).unwrap());
        diff.print(&format!("dense_{}_features", num_features));

        group.bench_function(format!("dense_{}_features", num_features), |b| {
            b.iter(|| {
                preprocess_features(
                    black_box(&raw_features),
                    black_box(&feature_order),
                    black_box(&config),
                )
                .unwrap()
            })
        });
    }
    group.finish();
}

fn bench_preprocess_features_imputed(c: &mut Criterion) {
    let mut group = c.benchmark_group("preprocessing_with_imputation");

    for &num_features in &[15, 30, 60] {
        let (feature_order, raw_features, config) = build_feature_environment(num_features, 0.25);
        group.throughput(Throughput::Elements(1));

        let (_, diff) = TRACKER
            .measure(|| preprocess_features(&raw_features, &feature_order, &config).unwrap());
        diff.print(&format!("imputed_{}_features", num_features));

        group.bench_function(format!("imputed_{}_features", num_features), |b| {
            b.iter(|| {
                preprocess_features(
                    black_box(&raw_features),
                    black_box(&feature_order),
                    black_box(&config),
                )
                .unwrap()
            })
        });
    }
    group.finish();
}

criterion_group!(
    benches,
    bench_preprocess_features_dense,
    bench_preprocess_features_imputed
);
criterion_main!(benches);
