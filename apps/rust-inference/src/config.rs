use std::env;

#[derive(Debug, Clone)]
pub struct CoreConfig {
    pub env: String,
    pub log_level: String,
}

#[derive(Debug, Clone)]
pub struct MinioConfig {
    pub endpoint: String,
    pub access_key: String,
    pub secret_key: String,
    pub bucket: String,
    pub prediction_bucket: String,
}

#[derive(Debug, Clone)]
pub struct NatsConfig {
    pub url: String,
    pub stream: String,
    pub durable: String,
    pub subject: String,
    pub workers: usize,
    pub ack_wait_secs: u64,
}

#[derive(Debug, Clone)]
pub struct MlConfig {
    pub device: String,
    pub intra_threads: usize,
    pub max_gold_bytes: usize,
}

#[derive(Debug, Clone)]
pub struct ObserverConfig {
    pub addr: String,
}

#[derive(Debug, Clone)]
pub struct Config {
    pub core: CoreConfig,
    pub minio: MinioConfig,
    pub nats: NatsConfig,
    pub ml: MlConfig,
    pub observer: ObserverConfig,
}

impl Config {
    pub fn from_env() -> Result<Self, String> {
        let device = require_env("AURORA_ML_DEVICE")?.to_lowercase();
        if !matches!(device.as_str(), "auto" | "cuda" | "cpu") {
            return Err(format!(
                "Invalid AURORA_ML_DEVICE: '{}'. Expected auto, cuda, or cpu",
                device
            ));
        }

        let workers = env::var("AURORA_INFERENCE_WORKERS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(1);
        let ack_wait_secs = env::var("AURORA_INFERENCE_ACK_WAIT_SECS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(300);
        let intra_threads = env::var("AURORA_INFERENCE_INTRA_THREADS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(1);
        let max_gold_bytes = env::var("AURORA_INFERENCE_MAX_GOLD_BYTES")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(512 * 1024 * 1024);
        if workers == 0 || intra_threads == 0 || ack_wait_secs == 0 || max_gold_bytes == 0 {
            return Err(
                "Inference worker, thread, ack wait, and Gold byte limits must be > 0".to_string(),
            );
        }

        Ok(Self {
            core: CoreConfig {
                env: require_env("AURORA_ENV")?,
                log_level: require_env("AURORA_LOG_LEVEL")?,
            },
            minio: MinioConfig {
                endpoint: require_env("MINIO_ENDPOINT")?,
                access_key: require_env("MINIO_ACCESS_KEY")?,
                secret_key: require_env("MINIO_SECRET_KEY")?,
                bucket: require_env("MINIO_BUCKET")?,
                prediction_bucket: env::var("AURORA_PREDICTION_BUCKET")
                    .unwrap_or_else(|_| require_env_fallback("MINIO_BUCKET", "aurora")),
            },
            nats: NatsConfig {
                url: require_env("NATS_URL")?,
                stream: env::var("AURORA_INFERENCE_STREAM")
                    .unwrap_or_else(|_| "AURORA_INFERENCE".to_string()),
                durable: env::var("AURORA_INFERENCE_DURABLE")
                    .unwrap_or_else(|_| "aurora-rust-inference".to_string()),
                subject: env::var("AURORA_INFERENCE_SUBJECT")
                    .unwrap_or_else(|_| "aurora.v1.inference.candidate.requested".to_string()),
                workers,
                ack_wait_secs,
            },
            ml: MlConfig {
                device,
                intra_threads,
                max_gold_bytes,
            },
            observer: ObserverConfig {
                addr: env::var("AURORA_INFERENCE_METRICS_ADDR")
                    .unwrap_or_else(|_| "0.0.0.0:8084".to_string()),
            },
        })
    }

    pub fn log_summary(&self) {
        tracing::info!(
            env = %self.core.env,
            log_level = %self.core.log_level,
            device = %self.ml.device,
            minio_endpoint = %self.minio.endpoint,
            minio_bucket = %self.minio.bucket,
            prediction_bucket = %self.minio.prediction_bucket,
            nats_url = %self.nats.url,
            nats_stream = %self.nats.stream,
            nats_durable = %self.nats.durable,
            nats_subject = %self.nats.subject,
            workers = self.nats.workers,
            observer_addr = %self.observer.addr,
            "Configuration summary loaded"
        );
    }
}

fn require_env(key: &str) -> Result<String, String> {
    env::var(key).map_err(|_| format!("Missing required environment variable '{key}'"))
}

fn require_env_fallback(key: &str, fallback: &str) -> String {
    env::var(key).unwrap_or_else(|_| fallback.to_string())
}
