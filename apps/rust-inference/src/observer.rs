//! Low-cardinality Prometheus observer for the GPU inference worker.
//!
//! Runtime IDs, object keys, and product IDs are deliberately excluded from
//! labels so metric cardinality stays bounded in long-running deployments.

use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use prometheus::{
    Encoder, Gauge, HistogramVec, IntCounterVec, IntGauge, Opts, Registry, TextEncoder,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio_util::sync::CancellationToken;

const STATUS_SUCCESS: &str = "success";
const STATUS_FAILED: &str = "failed";

pub struct Metrics {
    registry: Registry,
    jobs: IntCounterVec,
    duration: HistogramVec,
    errors: IntCounterVec,
    inflight: IntGauge,
    queue: IntGauge,
    rows: IntCounterVec,
    last_success: Gauge,
}

impl Metrics {
    pub fn new() -> Result<Self, prometheus::Error> {
        let registry = Registry::new();
        let jobs = IntCounterVec::new(
            Opts::new(
                "aurora_inference_jobs_total",
                "Inference jobs reaching a terminal status.",
            ),
            &["task", "status"],
        )?;
        let duration = HistogramVec::new(
            prometheus::HistogramOpts::new(
                "aurora_inference_processing_duration_seconds",
                "Wall-clock time spent processing one inference job.",
            ),
            &["task"],
        )?;
        let errors = IntCounterVec::new(
            Opts::new(
                "aurora_inference_errors_total",
                "Inference errors by bounded task.",
            ),
            &["task"],
        )?;
        let inflight = IntGauge::new(
            "aurora_inference_inflight_jobs",
            "Inference jobs currently executing.",
        )?;
        let queue = IntGauge::new(
            "aurora_inference_queue_depth",
            "Fetched inference messages waiting to run.",
        )?;
        let rows = IntCounterVec::new(
            Opts::new(
                "aurora_inference_rows_processed_total",
                "Gold rows successfully inferred.",
            ),
            &["task"],
        )?;
        let last_success = Gauge::new(
            "aurora_inference_last_success_timestamp_seconds",
            "Unix timestamp of the last successful inference job.",
        )?;

        for collector in [
            Box::new(jobs.clone()) as Box<dyn prometheus::core::Collector>,
            Box::new(duration.clone()),
            Box::new(errors.clone()),
            Box::new(inflight.clone()),
            Box::new(queue.clone()),
            Box::new(rows.clone()),
            Box::new(last_success.clone()),
        ] {
            registry.register(collector)?;
        }

        // Materialize the bounded label space so a fresh worker exposes all
        // seven metric families before the first job arrives.
        for task in ["candidate", "anomaly", "unknown"] {
            for status in [STATUS_SUCCESS, STATUS_FAILED] {
                jobs.with_label_values(&[task, status]);
            }
            duration.with_label_values(&[task]);
            errors.with_label_values(&[task]);
            rows.with_label_values(&[task]);
        }

        Ok(Self {
            registry,
            jobs,
            duration,
            errors,
            inflight,
            queue,
            rows,
            last_success,
        })
    }

    pub fn set_queue_depth(&self, depth: usize) {
        self.queue.set(depth as i64);
    }

    pub fn record_transport_error(&self) {
        self.errors.with_label_values(&["unknown"]).inc();
    }

    pub fn begin(self: &Arc<Self>, task: &str, rows: usize) -> JobObservation {
        self.inflight.inc();
        JobObservation {
            metrics: Arc::clone(self),
            task: normalize_task(task).to_string(),
            status: STATUS_FAILED,
            started: Instant::now(),
            rows,
        }
    }

    fn finish(&self, observation: &JobObservation) {
        let task = observation.task.as_str();
        let status = observation.status;
        self.inflight.dec();
        self.jobs.with_label_values(&[task, status]).inc();
        self.duration
            .with_label_values(&[task])
            .observe(observation.started.elapsed().as_secs_f64());
        if status == STATUS_FAILED {
            self.errors.with_label_values(&[task]).inc();
        } else {
            if observation.rows > 0 {
                self.rows
                    .with_label_values(&[task])
                    .inc_by(observation.rows as u64);
            }
            self.last_success.set(
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or(Duration::ZERO)
                    .as_secs_f64(),
            );
        }
    }

    pub fn render(&self) -> Vec<u8> {
        let mut buffer = Vec::new();
        TextEncoder::new()
            .encode(&self.registry.gather(), &mut buffer)
            .expect("encoding metrics into memory cannot fail");
        buffer
    }

    pub fn registry(&self) -> &Registry {
        &self.registry
    }
}

pub struct JobObservation {
    metrics: Arc<Metrics>,
    task: String,
    status: &'static str,
    started: Instant,
    rows: usize,
}

impl JobObservation {
    pub fn set_task(&mut self, task: &str) {
        self.task = normalize_task(task).to_string();
    }

    pub fn set_rows(&mut self, rows: usize) {
        self.rows = rows;
    }

    pub fn set_success(&mut self) {
        self.status = STATUS_SUCCESS;
    }
}

impl Drop for JobObservation {
    fn drop(&mut self) {
        Arc::clone(&self.metrics).finish(self);
    }
}

fn normalize_task(task: &str) -> &'static str {
    match task {
        "candidate" | "candidate_vetting" => "candidate",
        "anomaly" | "anomaly_detection" => "anomaly",
        _ => "unknown",
    }
}

pub async fn start(
    addr: &str,
    metrics: Arc<Metrics>,
    cancel: CancellationToken,
) -> Result<tokio::task::JoinHandle<()>, std::io::Error> {
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
                accepted = listener.accept() => match accepted {
                    Ok((stream, _)) => {
                        let metrics = Arc::clone(&metrics);
                        tokio::spawn(async move {
                            if let Err(error) = serve_connection(stream, metrics).await {
                                tracing::debug!(error = %error, "Metrics connection closed with error");
                            }
                        });
                    }
                    Err(error) => tracing::warn!(error = %error, "Metrics listener accept failed"),
                },
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
