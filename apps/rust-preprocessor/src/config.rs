use std::env;
use std::path::PathBuf;
use std::str::FromStr;

/// Core application config.
#[derive(Debug, Clone)]
pub struct CoreConfig {
    pub env: String,
    pub log_level: String,
}

/// MinIO / S3-compatible storage config.
#[derive(Debug, Clone)]
pub struct MinioConfig {
    pub endpoint: String,
    pub access_key: String,
    pub secret_key: String,
    pub bucket: String,
}

/// NATS connection config.
#[derive(Debug, Clone)]
pub struct NatsConfig {
    pub url: String,
}

/// JetStream consumer config.
#[derive(Debug, Clone)]
pub struct ConsumerConfig {
    /// Number of concurrent processing workers. Must be >= 1.
    pub workers: usize,
    /// Durable consumer name.
    pub durable: String,
    /// JetStream stream name.
    pub stream: String,
    /// JetStream ACK wait duration string (e.g. "30s").
    pub ack_wait: String,
    /// Shutdown drain timeout in seconds.
    pub shutdown_timeout_secs: u64,
    /// Temporary directory for FITS download staging.
    pub tmp_dir: PathBuf,
}

/// Light Curve scientific preprocessing configuration.
#[derive(Debug, Clone)]
pub struct LightCurveConfig {
    /// Minimum cadence count required to consider a Light Curve usable. Must be >= 1.
    pub min_points: usize,
    /// Quality mode: "strict" (keep quality == 0) or "none".
    pub quality_mode: String,
    /// Fallback to SAP_FLUX if PDCSAP_FLUX is missing.
    pub allow_sap_fallback: bool,
    /// Optional sigma clipping threshold (e.g. Some(5.0)). None/disabled by default.
    pub sigma_clip: Option<f64>,
}

/// Full application configuration.
#[derive(Debug, Clone)]
pub struct Config {
    pub core: CoreConfig,
    pub minio: MinioConfig,
    pub nats: NatsConfig,
    pub consumer: ConsumerConfig,
    pub lc_pipeline: LightCurveConfig,
}

impl Config {
    pub fn from_env() -> Result<Self, String> {
        let workers: usize = require_env_parse("AURORA_PREPROCESS_WORKERS")?;
        if workers < 1 {
            return Err("AURORA_PREPROCESS_WORKERS must be >= 1 (got 0)".to_string());
        }

        let tmp_dir = env::var("AURORA_PREPROCESS_TMP_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("/tmp/aurora-preprocessor"));

        let min_points: usize = env::var("AURORA_LC_MIN_POINTS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(100);
        if min_points < 1 {
            return Err("AURORA_LC_MIN_POINTS must be >= 1".to_string());
        }

        let quality_mode = env::var("AURORA_LC_QUALITY_MODE")
            .unwrap_or_else(|_| "strict".to_string())
            .to_lowercase();
        if quality_mode != "strict" && quality_mode != "none" {
            return Err(format!(
                "Invalid AURORA_LC_QUALITY_MODE '{quality_mode}' (allowed: 'strict', 'none')"
            ));
        }

        let allow_sap_fallback = env::var("AURORA_LC_ALLOW_SAP_FALLBACK")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(false);

        let sigma_clip = env::var("AURORA_LC_SIGMA_CLIP")
            .ok()
            .and_then(|v| v.parse::<f64>().ok())
            .filter(|&v| v > 0.0);

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
            },
            nats: NatsConfig {
                url: require_env("NATS_URL")?,
            },
            consumer: ConsumerConfig {
                workers,
                durable: env::var("AURORA_PREPROCESS_DURABLE")
                    .unwrap_or_else(|_| "aurora-rust-preprocessor".to_string()),
                stream: env::var("AURORA_PREPROCESS_STREAM")
                    .unwrap_or_else(|_| "AURORA_BRONZE".to_string()),
                ack_wait: env::var("AURORA_PREPROCESS_ACK_WAIT")
                    .unwrap_or_else(|_| "30s".to_string()),
                shutdown_timeout_secs: env::var("AURORA_PREPROCESS_SHUTDOWN_TIMEOUT")
                    .ok()
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(30),
                tmp_dir,
            },
            lc_pipeline: LightCurveConfig {
                min_points,
                quality_mode,
                allow_sap_fallback,
                sigma_clip,
            },
        })
    }

    pub fn log_summary(&self) {
        tracing::info!(
            env = %self.core.env,
            log_level = %self.core.log_level,
            workers = self.consumer.workers,
            nats_url = %self.nats.url,
            minio_endpoint = %self.minio.endpoint,
            minio_bucket = %self.minio.bucket,
            stream = %self.consumer.stream,
            durable = %self.consumer.durable,
            tmp_dir = %self.consumer.tmp_dir.display(),
            lc_min_points = self.lc_pipeline.min_points,
            lc_quality_mode = %self.lc_pipeline.quality_mode,
            lc_sap_fallback = self.lc_pipeline.allow_sap_fallback,
            lc_sigma_clip = ?self.lc_pipeline.sigma_clip,
            "Configuration summary loaded"
        );
    }
}

fn require_env(key: &str) -> Result<String, String> {
    env::var(key).map_err(|_| format!("Missing required environment variable '{key}'"))
}

fn require_env_parse<T: FromStr>(key: &str) -> Result<T, String> {
    let val = require_env(key)?;
    val.parse::<T>()
        .map_err(|_| format!("Invalid value for environment variable '{key}': '{val}'"))
}
