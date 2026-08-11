//! Prometheus Observer & Metrics Integration Tests.

use std::sync::Arc;

use aurora_inference::observer::Metrics;
use prometheus::{Encoder, TextEncoder};

#[test]
fn metrics_are_bounded_and_record_a_successful_job() {
    let metrics = Arc::new(Metrics::new().unwrap());
    let mut observation = metrics.begin("candidate_vetting", 12);
    observation.set_success();
    drop(observation);

    let mut output = Vec::new();
    TextEncoder::new()
        .encode(&metrics.registry().gather(), &mut output)
        .unwrap();
    let text = String::from_utf8(output).unwrap();
    assert!(text.contains("aurora_inference_jobs_total{status=\"success\",task=\"candidate\"} 1"));
    assert!(text.contains("aurora_inference_rows_processed_total{task=\"candidate\"} 12"));
}

#[test]
fn test_metrics_render_output() {
    let metrics = Arc::new(Metrics::new().unwrap());
    let mut observation = metrics.begin("anomaly_detection", 5);
    observation.set_success();
    drop(observation);

    let output = metrics.render();
    let text = String::from_utf8(output).unwrap();
    assert!(text.contains("aurora_inference_jobs_total{status=\"success\",task=\"anomaly\"} 1"));
    assert!(text.contains("aurora_inference_rows_processed_total{task=\"anomaly\"} 5"));
}
