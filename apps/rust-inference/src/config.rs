use std::env;

#[derive(Debug, Clone)]
pub struct Config {
	pub env: String,
	pub log_level: String,
	pub minio_endpoint: String,
	pub minio_bucket: String,
	pub nats_url: String,
	pub device: String,
}

impl Config {
	pub fn from_env() -> Result<Self, String> {
		let env_name = env::var("AURORA_ENV").unwrap_or_else(|_| "development".to_string());
		let log_level = env::var("AURORA_LOG_LEVEL").unwrap_or_else(|_| "info".to_string());
		let minio_endpoint = env::var("MINIO_ENDPOINT").unwrap_or_else(|_| "http://minio:9000".to_string());
		let minio_bucket = env::var("MINIO_BUCKET").unwrap_or_else(|_| "aurora".to_string());
		let nats_url = env::var("NATS_URL").unwrap_or_else(|_| "nats://nats:4222".to_string());

		let device = env::var("AURORA_ML_DEVICE").unwrap_or_else(|_| "auto".to_string()).to_lowercase();
		if !["auto", "cpu", "cuda"].contains(&device.as_str()) {
			return Err(format!("Invalid AURORA_ML_DEVICE: '{}'. Must be 'auto', 'cpu', or 'cuda'", device));
		}

		Ok(Self {
			env: env_name,
			log_level,
			minio_endpoint,
			minio_bucket,
			nats_url,
			device,
		})
	}

	pub fn log_summary(&self) {
		println!(
			"[aurora-inference] Config: env={}, log_level={}, device={}, minio={}, bucket={}, nats={}",
			self.env, self.log_level, self.device, self.minio_endpoint, self.minio_bucket, self.nats_url
		);
	}
}
