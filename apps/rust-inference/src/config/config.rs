use super::helper::require_env;

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
pub struct MlConfig {
    pub device: String,
}

#[derive(Debug, Clone)]
pub struct Config {
    pub core: CoreConfig,
    pub minio: MinioConfig,
    pub nats: NatsConfig,
    pub ml: MlConfig,
}

impl Config {
    pub fn from_env() -> Result<Self, String> {
        let device = require_env("AURORA_ML_DEVICE")?.to_lowercase();
        if !["auto", "cpu", "cuda"].contains(&device.as_str()) {
            return Err(format!("Invalid AURORA_ML_DEVICE: '{}'. Must be 'auto', 'cpu', or 'cuda'", device));
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
            ml: MlConfig { device },
        })
    }

    pub fn log_summary(&self) {
        tracing::info!(
            env = %self.core.env,
            log_level = %self.core.log_level,
            device = %self.ml.device,
            minio_endpoint = %self.minio.endpoint,
            minio_bucket = %self.minio.bucket,
            nats_url = %self.nats.url,
            "Configuration summary loaded"
        );
    }
}
