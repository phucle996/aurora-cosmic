//! Small, low-cardinality Prometheus observer for the preprocessing worker.
//!
//! The observer intentionally measures pipeline health and throughput only;
//! product IDs, object keys, and request data are never metric labels.

use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use prometheus::{
    Encoder, Gauge, HistogramVec, IntCounterVec, IntGauge, Opts, Registry, TextEncoder,
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
        registry.register(Box::new(last_success.clone()))?;

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
        }
    }

    fn finish(&self, observation: &ProductObservation) {
        let status = observation.status;
        let kind = observation.kind.as_str();
        let elapsed = observation.started.elapsed().as_secs_f64();

        self.inflight.dec();
        self.products.with_label_values(&[kind, status]).inc();
        self.duration.with_label_values(&[kind]).observe(elapsed);

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
    }
}
