use std::env;
use std::str::FromStr;

/// Core application config.
#[derive(Debug, Clone)]
pub struct CoreConfig {
    pub env: String,
    pub log_level: String,
}

/// MinIO connection config (unused until Phase 3.2, kept for startup validation).
#[derive(Debug, Clone)]
pub struct MinioConfig {
    pub endpoint: String,
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
}

/// Full application configuration.
#[derive(Debug, Clone)]
pub struct Config {
    pub core: CoreConfig,
    pub minio: MinioConfig,
    pub nats: NatsConfig,
    pub consumer: ConsumerConfig,
}

impl Config {
    pub fn from_env() -> Result<Self, String> {
        let workers: usize = require_env_parse("AURORA_PREPROCESS_WORKERS")?;
        if workers < 1 {
            return Err("AURORA_PREPROCESS_WORKERS must be >= 1 (got 0)".to_string());
        }

        Ok(Self {
            core: CoreConfig {
                env: require_env("AURORA_ENV")?,
                log_level: require_env("AURORA_LOG_LEVEL")?,
            },
            minio: MinioConfig {
                endpoint: require_env("MINIO_ENDPOINT")?,
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
            },
        })
    }

    pub fn log_summary(&self) {
        tracing::info!(
            env = %self.core.env,
            log_level = %self.core.log_level,
            workers = self.consumer.workers,
            nats_url = %self.nats.url,
            stream = %self.consumer.stream,
            durable = %self.consumer.durable,
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    fn set_required_vars(workers: &str) {
        env::set_var("AURORA_ENV", "test");
        env::set_var("AURORA_LOG_LEVEL", "debug");
        env::set_var("MINIO_ENDPOINT", "http://localhost:9000");
        env::set_var("MINIO_BUCKET", "aurora");
        env::set_var("NATS_URL", "nats://localhost:4222");
        env::set_var("AURORA_PREPROCESS_WORKERS", workers);
    }

    #[test]
    fn test_zero_workers_rejected() {
        set_required_vars("0");
        let result = Config::from_env();
        assert!(result.is_err());
        let msg = result.unwrap_err();
        assert!(msg.contains("AURORA_PREPROCESS_WORKERS"));
    }

    #[test]
    fn test_valid_workers_accepted() {
        set_required_vars("4");
        let result = Config::from_env();
        assert!(result.is_ok());
        assert_eq!(result.unwrap().consumer.workers, 4);
    }

    #[test]
    fn test_defaults_applied() {
        set_required_vars("2");
        env::remove_var("AURORA_PREPROCESS_DURABLE");
        env::remove_var("AURORA_PREPROCESS_STREAM");
        let cfg = Config::from_env().unwrap();
        assert_eq!(cfg.consumer.durable, "aurora-rust-preprocessor");
        assert_eq!(cfg.consumer.stream, "AURORA_BRONZE");
    }
}
