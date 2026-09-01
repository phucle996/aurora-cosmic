//! Small, low-cardinality Prometheus observer for the preprocessing worker.
//!
//! The observer intentionally measures pipeline health and throughput only;
//! product IDs, object keys, and request data are never metric labels.

use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use prometheus::{
    Encoder, Gauge, GaugeVec, HistogramVec, IntCounterVec, IntGauge, Opts, Registry, TextEncoder,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio_util::sync::CancellationToken;

const STATUS_SUCCESS: &str = "success";
const STATUS_RECOVERED: &str = "recovered";
const STATUS_FAILED: &str = "failed";

/// Prometheus metrics exposed by the preprocessor.
pub struct Metrics {
    registry: Registry,
    products: IntCounterVec,
    duration: HistogramVec,
    errors: IntCounterVec,
    inflight: IntGauge,
    queue: IntGauge,
    backlog_pending: IntGauge,
    backlog_ack_pending: IntGauge,
    bytes: IntCounterVec,
    samples: IntCounterVec,
    finite_pixel_fraction: GaugeVec,
    normalized_scatter_ppm: HistogramVec,
    sigma_clip_fraction: HistogramVec,
    finite_pixel_fraction_distribution: HistogramVec,
    last_success: Gauge,
}

impl Metrics {
    /// Build an isolated registry so tests and embedded runtimes cannot
    /// accidentally register duplicate collectors in a process-global one.
    pub fn new() -> Result<Self, prometheus::Error> {
        let registry = Registry::new();
        let products = IntCounterVec::new(
            Opts::new(
                "aurora_preprocessor_products_total",
                "Products reaching a terminal preprocessing state.",
            ),
            &["kind", "status"],
        )?;
        let duration = HistogramVec::new(
            prometheus::HistogramOpts::new(
                "aurora_preprocessor_processing_duration_seconds",
                "Time spent processing one Bronze product until a terminal state.",
            ),
            &["kind"],
        )?;
        let errors = IntCounterVec::new(
            Opts::new(
                "aurora_preprocessor_errors_total",
                "Preprocessing failures by bounded product kind.",
            ),
            &["kind"],
        )?;
        let inflight = IntGauge::new(
            "aurora_preprocessor_inflight_workers",
            "Number of products currently processed by worker tasks.",
        )?;
        let queue = IntGauge::new(
            "aurora_preprocessor_queue_depth",
            "Number of fetched products waiting to be dispatched to workers.",
        )?;
        let backlog_pending = IntGauge::new(
            "aurora_preprocessor_backlog_pending",
            "Retained Bronze messages available for the preprocessing consumer.",
        )?;
        let backlog_ack_pending = IntGauge::new(
            "aurora_preprocessor_backlog_ack_pending",
            "Bronze messages fetched by preprocessing but not yet acknowledged.",
        )?;
        let bytes = IntCounterVec::new(
            Opts::new(
                "aurora_preprocessor_bytes_total",
                "Bronze bytes consumed and Silver bytes produced.",
            ),
            &["kind", "stage"],
        )?;
        let samples = IntCounterVec::new(
            Opts::new(
                "aurora_preprocessor_science_samples_total",
                "Scientific samples observed by preprocessing, grouped by bounded outcome.",
            ),
            &["kind", "outcome"],
        )?;
        let finite_pixel_fraction = GaugeVec::new(
            Opts::new(
                "aurora_preprocessor_finite_pixel_fraction",
                "Latest measured finite-pixel fraction for an image product.",
            ),
            &["kind"],
        )?;
        let normalized_scatter_ppm = HistogramVec::new(
            prometheus::HistogramOpts::new(
                "aurora_preprocessor_lc_normalized_scatter_ppm",
                "Distribution of per-product normalized Light Curve scatter before and after sigma clipping, in ppm.",
            )
            .buckets(vec![10.0, 30.0, 100.0, 300.0, 1_000.0, 3_000.0, 10_000.0, 30_000.0, 100_000.0, 1_000_000.0]),
            &["phase"],
        )?;
        let sigma_clip_fraction = HistogramVec::new(
            prometheus::HistogramOpts::new(
                "aurora_preprocessor_lc_sigma_clip_fraction",
                "Distribution of the fraction of quality-valid Light Curve cadences removed by sigma clipping.",
            )
            .buckets(vec![0.0, 0.0001, 0.0005, 0.001, 0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1.0]),
            &[],
        )?;
        let finite_pixel_fraction_distribution = HistogramVec::new(
            prometheus::HistogramOpts::new(
                "aurora_preprocessor_tpf_finite_pixel_fraction",
                "Distribution of finite-pixel fractions across processed Target Pixel products.",
            )
            .buckets(vec![0.5, 0.75, 0.9, 0.95, 0.99, 0.999, 1.0]),
            &[],
        )?;
        let last_success = Gauge::new(
            "aurora_preprocessor_last_success_timestamp_seconds",
            "Unix timestamp of the last successful or recovered product.",
        )?;

        registry.register(Box::new(products.clone()))?;
        registry.register(Box::new(duration.clone()))?;
        registry.register(Box::new(errors.clone()))?;
        registry.register(Box::new(inflight.clone()))?;
        registry.register(Box::new(queue.clone()))?;
        registry.register(Box::new(backlog_pending.clone()))?;
        registry.register(Box::new(backlog_ack_pending.clone()))?;
        registry.register(Box::new(bytes.clone()))?;
        registry.register(Box::new(samples.clone()))?;
        registry.register(Box::new(finite_pixel_fraction.clone()))?;
        registry.register(Box::new(normalized_scatter_ppm.clone()))?;
        registry.register(Box::new(sigma_clip_fraction.clone()))?;
        registry.register(Box::new(finite_pixel_fraction_distribution.clone()))?;
        registry.register(Box::new(last_success.clone()))?;

        // Materialize every bounded counter/histogram label at startup. Idle
        // workers then export zero-valued families instead of appearing to
        // have a broken Prometheus contract before their first product.
        for kind in ["lightcurve", "target_pixel", "ffi", "unknown"] {
            for status in [STATUS_SUCCESS, STATUS_RECOVERED, STATUS_FAILED] {
                products.with_label_values(&[kind, status]);
            }
            duration.with_label_values(&[kind]);
            errors.with_label_values(&[kind]);
            for stage in ["bronze", "silver"] {
                bytes.with_label_values(&[kind, stage]);
            }
            for outcome in [
                "input",
                "output",
                "quality_removed",
                "invalid_removed",
                "nonfinite_removed",
                "nonpositive_time_removed",
                "outlier_removed",
                "sigma_clip_3_4_removed",
                "sigma_clip_4_5_removed",
                "sigma_clip_ge_5_removed",
            ] {
                samples.with_label_values(&[kind, outcome]);
            }
        }
        for phase in ["before_clip", "after_clip"] {
            normalized_scatter_ppm.with_label_values(&[phase]);
        }
        sigma_clip_fraction.with_label_values(&[]);
        finite_pixel_fraction_distribution.with_label_values(&[]);

        Ok(Self {
            registry,
            products,
            duration,
            errors,
            inflight,
            queue,
            backlog_pending,
            backlog_ack_pending,
            bytes,
            samples,
            finite_pixel_fraction,
            normalized_scatter_ppm,
            sigma_clip_fraction,
            finite_pixel_fraction_distribution,
            last_success,
        })
    }

    pub fn set_queue_depth(&self, depth: usize) {
        self.queue.set(depth as i64);
    }

    pub fn set_backlog(&self, pending: u64, ack_pending: usize) {
        self.backlog_pending
            .set(pending.min(i64::MAX as u64) as i64);
        self.backlog_ack_pending
            .set(ack_pending.min(i64::MAX as usize) as i64);
    }

    pub fn record_transport_error(&self) {
        self.errors.with_label_values(&["unknown"]).inc();
    }

    pub fn begin(self: &Arc<Self>, kind: &str, input_bytes: u64) -> ProductObservation {
        self.inflight.inc();
        ProductObservation {
            metrics: Arc::clone(self),
            kind: normalize_kind(kind).to_string(),
            status: STATUS_FAILED,
            started: Instant::now(),
            input_bytes,
            output_bytes: 0,
            input_samples: 0,
            output_samples: 0,
            quality_removed: 0,
            invalid_removed: 0,
            nonfinite_removed: 0,
            nonpositive_time_removed: 0,
            outlier_removed: 0,
            sigma_clip_3_4_removed: 0,
            sigma_clip_4_5_removed: 0,
            sigma_clip_ge_5_removed: 0,
            finite_pixel_fraction: None,
            normalized_scatter_before_ppm: None,
            normalized_scatter_after_ppm: None,
        }
    }

    fn finish(&self, observation: &ProductObservation) {
        let status = observation.status;
        let kind = observation.kind.as_str();
        let elapsed = observation.started.elapsed().as_secs_f64();

        self.inflight.dec();
        self.products.with_label_values(&[kind, status]).inc();
        self.duration.with_label_values(&[kind]).observe(elapsed);

        for (outcome, value) in [
            ("input", observation.input_samples),
            ("output", observation.output_samples),
            ("quality_removed", observation.quality_removed),
            ("invalid_removed", observation.invalid_removed),
            ("nonfinite_removed", observation.nonfinite_removed),
            (
                "nonpositive_time_removed",
                observation.nonpositive_time_removed,
            ),
            ("outlier_removed", observation.outlier_removed),
            ("sigma_clip_3_4_removed", observation.sigma_clip_3_4_removed),
            ("sigma_clip_4_5_removed", observation.sigma_clip_4_5_removed),
            (
                "sigma_clip_ge_5_removed",
                observation.sigma_clip_ge_5_removed,
            ),
        ] {
            if value > 0 {
                self.samples
                    .with_label_values(&[kind, outcome])
                    .inc_by(value);
            }
        }
        if let Some(value) = observation.finite_pixel_fraction {
            self.finite_pixel_fraction
                .with_label_values(&[kind])
                .set(value);
            if kind == "target_pixel" {
                self.finite_pixel_fraction_distribution
                    .with_label_values(&[])
                    .observe(value);
            }
        }
        if kind == "lightcurve" {
            if let Some(value) = observation.normalized_scatter_before_ppm {
                self.normalized_scatter_ppm
                    .with_label_values(&["before_clip"])
                    .observe(value);
            }
            if let Some(value) = observation.normalized_scatter_after_ppm {
                self.normalized_scatter_ppm
                    .with_label_values(&["after_clip"])
                    .observe(value);
            }
            let preclip_samples = observation
                .output_samples
                .saturating_add(observation.outlier_removed);
            if preclip_samples > 0 {
                self.sigma_clip_fraction
                    .with_label_values(&[])
                    .observe(observation.outlier_removed as f64 / preclip_samples as f64);
            }
        }

        if status == STATUS_FAILED {
            self.errors.with_label_values(&[kind]).inc();
            return;
        }

        if observation.input_bytes > 0 {
            self.bytes
                .with_label_values(&[kind, "bronze"])
                .inc_by(observation.input_bytes);
        }
        if observation.output_bytes > 0 {
            self.bytes
                .with_label_values(&[kind, "silver"])
                .inc_by(observation.output_bytes);
        }
        self.last_success.set(
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or(Duration::ZERO)
                .as_secs_f64(),
        );
    }

    fn render(&self) -> Vec<u8> {
        let metric_families = self.registry.gather();
        let mut buffer = Vec::new();
        TextEncoder::new()
            .encode(&metric_families, &mut buffer)
            .expect("encoding metrics into an in-memory buffer cannot fail");
        buffer
    }
}

/// RAII observation for one NATS product. Every return path, including a
/// panic unwind, records exactly one terminal product result.
pub struct ProductObservation {
    metrics: Arc<Metrics>,
    kind: String,
    status: &'static str,
    started: Instant,
    input_bytes: u64,
    output_bytes: u64,
    input_samples: u64,
    output_samples: u64,
    quality_removed: u64,
    invalid_removed: u64,
    nonfinite_removed: u64,
    nonpositive_time_removed: u64,
    outlier_removed: u64,
    sigma_clip_3_4_removed: u64,
    sigma_clip_4_5_removed: u64,
    sigma_clip_ge_5_removed: u64,
    finite_pixel_fraction: Option<f64>,
    normalized_scatter_before_ppm: Option<f64>,
    normalized_scatter_after_ppm: Option<f64>,
}

impl ProductObservation {
    pub fn set_kind(&mut self, kind: &str) {
        self.kind = normalize_kind(kind).to_string();
    }

    pub fn set_input_bytes(&mut self, bytes: u64) {
        self.input_bytes = bytes;
    }

    pub fn set_success(&mut self) {
        self.status = STATUS_SUCCESS;
    }

    pub fn set_recovered(&mut self) {
        self.status = STATUS_RECOVERED;
    }

    pub fn set_output_bytes(&mut self, bytes: u64) {
        self.output_bytes = bytes;
    }

    pub fn set_science_metadata(&mut self, metadata: &std::collections::HashMap<String, String>) {
        let integer = |keys: &[&str]| -> u64 {
            keys.iter()
                .find_map(|key| metadata.get(*key).and_then(|value| value.parse().ok()))
                .unwrap_or(0)
        };
        self.input_samples = integer(&["input-points", "input-cadences"]);
        self.output_samples = integer(&["output-points", "output-cadences"]);
        self.quality_removed = integer(&["quality-removed"]);
        self.invalid_removed = integer(&["invalid-removed", "invalid-time-removed"]);
        self.nonfinite_removed = integer(&["nonfinite-removed"]);
        self.nonpositive_time_removed = integer(&["nonpositive-time-removed"]);
        self.outlier_removed = integer(&["outlier-removed"]);
        self.sigma_clip_3_4_removed = integer(&["sigma-clip-3-4-removed"]);
        self.sigma_clip_4_5_removed = integer(&["sigma-clip-4-5-removed"]);
        self.sigma_clip_ge_5_removed = integer(&["sigma-clip-ge-5-removed"]);
        self.finite_pixel_fraction = metadata
            .get("finite-pixel-fraction")
            .and_then(|value| value.parse::<f64>().ok())
            .filter(|value| value.is_finite());
        self.normalized_scatter_before_ppm =
            finite_nonnegative(metadata.get("normalized-scatter-before-clip-ppm"));
        self.normalized_scatter_after_ppm =
            finite_nonnegative(metadata.get("normalized-scatter-after-clip-ppm"));
    }
}

fn finite_nonnegative(value: Option<&String>) -> Option<f64> {
    value
        .and_then(|raw| raw.parse::<f64>().ok())
        .filter(|parsed| parsed.is_finite() && *parsed >= 0.0)
}

impl Drop for ProductObservation {
    fn drop(&mut self) {
        let metrics = Arc::clone(&self.metrics);
        metrics.finish(self);
    }
}

fn normalize_kind(kind: &str) -> &'static str {
    match kind {
        "lightcurve" | "LightCurve" | "LIGHT_CURVE" => "lightcurve",
        "target_pixel" | "TargetPixel" | "TARGET_PIXEL" => "target_pixel",
        "ffi" | "Ffi" | "FFI" => "ffi",
        _ => "unknown",
    }
}

/// Start the metrics listener and return its task handle. Binding happens
/// before returning, so a bad address fails application startup immediately.
pub async fn start(
    addr: &str,
    metrics: Arc<Metrics>,
    cancel: CancellationToken,
) -> Result<tokio::task::JoinHandle<()>, std::io::Error> {
    // Accept the familiar `:PORT` form used by Docker env files while
    // normalizing it to a Rust socket address.
    let bind_addr = if addr.starts_with(':') {
        format!("0.0.0.0{addr}")
    } else {
        addr.to_string()
    };
    let listener = TcpListener::bind(&bind_addr).await?;
    Ok(tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = cancel.cancelled() => break,
                accepted = listener.accept() => {
                    match accepted {
                        Ok((stream, _)) => {
                            let metrics = Arc::clone(&metrics);
                            tokio::spawn(async move {
                                if let Err(error) = serve_connection(stream, metrics).await {
                                    tracing::debug!(error = %error, "Metrics connection closed with error");
                                }
                            });
                        }
                        Err(error) => tracing::warn!(error = %error, "Metrics listener accept failed"),
                    }
                }
            }
        }
    }))
}

async fn serve_connection(
    mut stream: TcpStream,
    metrics: Arc<Metrics>,
) -> Result<(), std::io::Error> {
    let mut request = [0_u8; 2048];
    let bytes_read = stream.read(&mut request).await?;
    let request_line = std::str::from_utf8(&request[..bytes_read]).unwrap_or_default();
    let path = request_line
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .unwrap_or("/");

    let (status, content_type, body) = match path {
        "/metrics" => (
            "200 OK",
            "text/plain; version=0.0.4; charset=utf-8",
            metrics.render(),
        ),
        "/healthz" => ("200 OK", "text/plain; charset=utf-8", b"ok\n".to_vec()),
        _ => (
            "404 Not Found",
            "text/plain; charset=utf-8",
            b"not found\n".to_vec(),
        ),
    };
    let header = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(header.as_bytes()).await?;
    stream.write_all(&body).await?;
    stream.shutdown().await
}

#[cfg(test)]
mod tests {
    use super::*;
    use prometheus::Encoder;

    #[test]
    fn metrics_are_bounded_and_record_terminal_product() {
        let metrics = Arc::new(Metrics::new().unwrap());
        let mut observation = metrics.begin("LIGHT_CURVE", 128);
        observation.set_output_bytes(64);
        observation.set_science_metadata(&std::collections::HashMap::from([
            ("input-points".to_string(), "100".to_string()),
            ("output-points".to_string(), "75".to_string()),
            ("quality-removed".to_string(), "20".to_string()),
            ("nonfinite-removed".to_string(), "3".to_string()),
            ("nonpositive-time-removed".to_string(), "2".to_string()),
            ("outlier-removed".to_string(), "5".to_string()),
            ("sigma-clip-3-4-removed".to_string(), "1".to_string()),
            ("sigma-clip-4-5-removed".to_string(), "1".to_string()),
            ("sigma-clip-ge-5-removed".to_string(), "3".to_string()),
            (
                "normalized-scatter-before-clip-ppm".to_string(),
                "1200".to_string(),
            ),
            (
                "normalized-scatter-after-clip-ppm".to_string(),
                "800".to_string(),
            ),
        ]));
        observation.set_success();
        drop(observation);

        let mut output = Vec::new();
        TextEncoder::new()
            .encode(&metrics.registry.gather(), &mut output)
            .unwrap();
        let text = String::from_utf8(output).unwrap();
        assert!(text.contains(
            "aurora_preprocessor_products_total{kind=\"lightcurve\",status=\"success\"} 1"
        ));
        assert!(text
            .contains("aurora_preprocessor_bytes_total{kind=\"lightcurve\",stage=\"bronze\"} 128"));
        assert!(text
            .contains("aurora_preprocessor_bytes_total{kind=\"lightcurve\",stage=\"silver\"} 64"));
        assert!(text.contains(
            "aurora_preprocessor_science_samples_total{kind=\"lightcurve\",outcome=\"input\"} 100"
        ));
        assert!(text.contains("aurora_preprocessor_science_samples_total{kind=\"lightcurve\",outcome=\"outlier_removed\"} 5"));
        assert!(text.contains("aurora_preprocessor_science_samples_total{kind=\"lightcurve\",outcome=\"sigma_clip_3_4_removed\"} 1"));
        assert!(text.contains("aurora_preprocessor_science_samples_total{kind=\"lightcurve\",outcome=\"sigma_clip_4_5_removed\"} 1"));
        assert!(text.contains("aurora_preprocessor_science_samples_total{kind=\"lightcurve\",outcome=\"sigma_clip_ge_5_removed\"} 3"));
        assert!(text.contains("aurora_preprocessor_science_samples_total{kind=\"lightcurve\",outcome=\"nonfinite_removed\"} 3"));
        assert!(text.contains("aurora_preprocessor_science_samples_total{kind=\"lightcurve\",outcome=\"nonpositive_time_removed\"} 2"));
        assert!(text.contains(
            "aurora_preprocessor_lc_normalized_scatter_ppm_count{phase=\"before_clip\"} 1"
        ));
        assert!(text.contains(
            "aurora_preprocessor_lc_normalized_scatter_ppm_count{phase=\"after_clip\"} 1"
        ));
        assert!(text.contains("aurora_preprocessor_lc_sigma_clip_fraction_count 1"));
    }
}
