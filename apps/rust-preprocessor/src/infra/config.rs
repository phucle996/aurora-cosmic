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

/// Prometheus observer HTTP endpoint configuration.
#[derive(Debug, Clone)]
pub struct ObserverConfig {
    pub addr: String,
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
    /// Maximum JetStream redelivery attempts before treating as terminal.
    pub max_deliveries: i64,
    /// Retry backoff sequence in seconds (used for JetStream BackOff config).
    pub retry_backoff_secs: Vec<u64>,
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

/// TPF and FFI image preprocessing configuration.
#[derive(Debug, Clone)]
pub struct ImageConfig {
    /// Quality mode for TPF: "strict" (quality == 0) or "none".
    pub tpf_quality_mode: String,
    /// TPF normalization strategy: "temporal-median" (default) or "global-median".
    pub tpf_normalization: String,
    /// FFI normalization strategy: "median" (default) or "none".
    pub ffi_normalization: String,
    /// FFI cutout side dimension (e.g. 32 for 32x32). Must be >= 1.
    pub ffi_cutout_size: usize,
}

/// Full application configuration.
#[derive(Debug, Clone)]
pub struct Config {
    pub core: CoreConfig,
    pub minio: MinioConfig,
    pub nats: NatsConfig,
    pub observer: ObserverConfig,
    pub consumer: ConsumerConfig,
    pub lc_pipeline: LightCurveConfig,
    pub image_pipeline: ImageConfig,
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

        let tpf_quality_mode = env::var("AURORA_TPF_QUALITY_MODE")
            .unwrap_or_else(|_| "strict".to_string())
            .to_lowercase();
        if tpf_quality_mode != "strict" && tpf_quality_mode != "none" {
            return Err(format!(
                "Invalid AURORA_TPF_QUALITY_MODE '{tpf_quality_mode}' (allowed: 'strict', 'none')"
            ));
        }

        let tpf_normalization = env::var("AURORA_TPF_NORMALIZATION")
            .unwrap_or_else(|_| "temporal-median".to_string())
            .to_lowercase();
        if !matches!(
            tpf_normalization.as_str(),
            "temporal-median" | "global-median" | "none"
        ) {
            return Err(format!(
                "Invalid AURORA_TPF_NORMALIZATION '{tpf_normalization}' (allowed: 'temporal-median', 'global-median', 'none')"
            ));
        }

        let ffi_normalization = env::var("AURORA_FFI_NORMALIZATION")
            .unwrap_or_else(|_| "median".to_string())
            .to_lowercase();
        if !matches!(ffi_normalization.as_str(), "median" | "none") {
            return Err(format!(
                "Invalid AURORA_FFI_NORMALIZATION '{ffi_normalization}' (allowed: 'median', 'none')"
            ));
        }

        let ffi_cutout_size: usize = env::var("AURORA_FFI_CUTOUT_SIZE")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(32);
        if ffi_cutout_size < 1 {
            return Err("AURORA_FFI_CUTOUT_SIZE must be >= 1".to_string());
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
            },
            nats: NatsConfig {
                url: require_env("NATS_URL")?,
            },
            observer: ObserverConfig {
                addr: env::var("AURORA_METRICS_ADDR")
                    .unwrap_or_else(|_| "0.0.0.0:8082".to_string()),
            },
            consumer: ConsumerConfig {
                workers,
                durable: env::var("AURORA_PREPROCESS_DURABLE")
                    .unwrap_or_else(|_| "aurora-rust-preprocessor".to_string()),
                stream: env::var("AURORA_PREPROCESS_STREAM")
                    .unwrap_or_else(|_| "AURORA_BRONZE".to_string()),
                ack_wait: env::var("AURORA_PREPROCESS_ACK_WAIT")
                    .unwrap_or_else(|_| "5m".to_string()),
                shutdown_timeout_secs: env::var("AURORA_PREPROCESS_SHUTDOWN_TIMEOUT")
                    .ok()
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(30),
                tmp_dir,
                max_deliveries: env::var("AURORA_PREPROCESS_MAX_DELIVERIES")
                    .ok()
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(5),
                retry_backoff_secs: parse_backoff_env(),
            },
            lc_pipeline: LightCurveConfig {
                min_points,
                quality_mode,
                allow_sap_fallback,
                sigma_clip,
            },
            image_pipeline: ImageConfig {
                tpf_quality_mode,
                tpf_normalization,
                ffi_normalization,
                ffi_cutout_size,
            },
        })
    }

    pub fn log_summary(&self) {
        tracing::info!(
            env = %self.core.env,
            log_level = %self.core.log_level,
            workers = self.consumer.workers,
            nats_url = %self.nats.url,
            metrics_addr = %self.observer.addr,
            minio_endpoint = %self.minio.endpoint,
            minio_bucket = %self.minio.bucket,
            stream = %self.consumer.stream,
            durable = %self.consumer.durable,
            ack_wait = %self.consumer.ack_wait,
            max_deliveries = self.consumer.max_deliveries,
            tmp_dir = %self.consumer.tmp_dir.display(),
            lc_min_points = self.lc_pipeline.min_points,
            lc_quality_mode = %self.lc_pipeline.quality_mode,
            tpf_quality_mode = %self.image_pipeline.tpf_quality_mode,
            tpf_normalization = %self.image_pipeline.tpf_normalization,
            ffi_normalization = %self.image_pipeline.ffi_normalization,
            ffi_cutout_size = self.image_pipeline.ffi_cutout_size,
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

/// Parse `AURORA_PREPROCESS_RETRY_BACKOFF` — a comma-separated list of seconds.
///
/// Default V1 backoff sequence: 5s, 30s, 120s, 600s
fn parse_backoff_env() -> Vec<u64> {
    env::var("AURORA_PREPROCESS_RETRY_BACKOFF")
        .ok()
        .and_then(|v| {
            let parsed: Option<Vec<u64>> =
                v.split(',').map(|s| s.trim().parse::<u64>().ok()).collect();
            parsed
        })
        .unwrap_or_else(|| vec![5, 30, 120, 600])
}
