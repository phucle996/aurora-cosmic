//! Prometheus Observer & Metrics Integration Tests.

use std::sync::Arc;
use std::time::Duration;

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
fn test_metrics_render_output_and_stages() {
    let metrics = Arc::new(Metrics::new().unwrap());
    metrics.record_stage("download", Duration::from_millis(45));
    metrics.record_stage("inference", Duration::from_millis(120));
    metrics.record_stage("upload", Duration::from_millis(30));
    metrics.record_retry("candidate");

    let mut observation = metrics.begin("candidate_vetting", 5);
    observation.set_success();
    drop(observation);

    let output = metrics.render();
    let text = String::from_utf8(output).unwrap();
    assert!(text.contains("aurora_inference_jobs_total{status=\"success\",task=\"candidate\"} 1"));
    assert!(text.contains("aurora_inference_rows_processed_total{task=\"candidate\"} 5"));
    assert!(text.contains("aurora_inference_stage_duration_seconds_count{stage=\"download\"} 1"));
    assert!(text.contains("aurora_inference_retries_total{task=\"candidate\"} 1"));
    assert!(text.contains("aurora_inference_info{engine=\"ort\",version=\"0.1.0\"} 1"));
}
