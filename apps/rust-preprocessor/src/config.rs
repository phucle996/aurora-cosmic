use std::env;

#[derive(Debug, Clone)]
pub struct Config {
	pub env: String,
	pub log_level: String,
	pub minio_endpoint: String,
	pub minio_bucket: String,
	pub nats_url: String,
	pub workers: usize,
}

impl Config {
	pub fn from_env() -> Result<Self, String> {
		let env_name = env::var("AURORA_ENV").unwrap_or_else(|_| "development".to_string());
		let log_level = env::var("AURORA_LOG_LEVEL").unwrap_or_else(|_| "info".to_string());
		let minio_endpoint = env::var("MINIO_ENDPOINT").unwrap_or_else(|_| "http://minio:9000".to_string());
		let minio_bucket = env::var("MINIO_BUCKET").unwrap_or_else(|_| "aurora".to_string());
		let nats_url = env::var("NATS_URL").unwrap_or_else(|_| "nats://nats:4222".to_string());

		let workers_str = env::var("AURORA_PREPROCESS_WORKERS").unwrap_or_else(|_| "4".to_string());
		let workers: usize = workers_str
			.parse()
			.map_err(|_| format!("AURORA_PREPROCESS_WORKERS must be a positive integer, got '{}'", workers_str))?;

		if workers < 1 {
			return Err("AURORA_PREPROCESS_WORKERS must be >= 1".to_string());
		}

		Ok(Self {
			env: env_name,
			log_level,
			minio_endpoint,
			minio_bucket,
			nats_url,
			workers,
		})
	}

	pub fn log_summary(&self) {
		println!(
			"[aurora-preprocessor] Config: env={}, log_level={}, workers={}, minio={}, bucket={}, nats={}",
			self.env, self.log_level, self.workers, self.minio_endpoint, self.minio_bucket, self.nats_url
		);
	}
}
