use super::helper::{get_env, get_env_parse};

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
        let workers = get_env_parse("AURORA_PREPROCESS_WORKERS", 4)?;
        if workers < 1 {
            return Err("AURORA_PREPROCESS_WORKERS must be >= 1".to_string());
        }

        Ok(Self {
            core: CoreConfig {
                env: get_env("AURORA_ENV", "development"),
                log_level: get_env("AURORA_LOG_LEVEL", "info"),
            },
            minio: MinioConfig {
                endpoint: get_env("MINIO_ENDPOINT", "http://minio:9000"),
                bucket: get_env("MINIO_BUCKET", "aurora"),
            },
            nats: NatsConfig {
                url: get_env("NATS_URL", "nats://nats:4222"),
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
