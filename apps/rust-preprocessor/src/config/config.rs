use super::helper::{require_env, require_env_parse};

#[derive(Debug, Clone)]
pub struct CoreConfig {
    pub env: String,
    pub log_level: String,
}

#[derive(Debug, Clone)]
pub struct MinioConfig {
    pub endpoint: String,
    pub bucket: String,
}

#[derive(Debug, Clone)]
pub struct NatsConfig {
    pub url: String,
}

#[derive(Debug, Clone)]
pub struct PreprocessConfig {
    pub workers: usize,
}

#[derive(Debug, Clone)]
pub struct Config {
    pub core: CoreConfig,
    pub minio: MinioConfig,
    pub nats: NatsConfig,
    pub preprocess: PreprocessConfig,
}

impl Config {
    pub fn from_env() -> Result<Self, String> {
        let workers: usize = require_env_parse("AURORA_PREPROCESS_WORKERS")?;
        if workers < 1 {
            return Err("AURORA_PREPROCESS_WORKERS must be >= 1".to_string());
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
            preprocess: PreprocessConfig { workers },
        })
    }

    pub fn log_summary(&self) {
        tracing::info!(
            env = %self.core.env,
            log_level = %self.core.log_level,
            workers = self.preprocess.workers,
            minio_endpoint = %self.minio.endpoint,
            minio_bucket = %self.minio.bucket,
            nats_url = %self.nats.url,
            "Configuration summary loaded"
        );
    }
}
