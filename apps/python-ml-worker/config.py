import os


class Config:
    def __init__(self):
        self.env = self._require_env("AURORA_ENV")
        self.log_level = os.getenv("AURORA_LOG_LEVEL", "info")
        self.minio_endpoint = self._require_env("MINIO_ENDPOINT")
        self.minio_bucket = self._require_env("MINIO_BUCKET")
        self.minio_access_key = self._require_env("MINIO_ACCESS_KEY")
        self.minio_secret_key = self._require_env("MINIO_SECRET_KEY")
        self.minio_secure = self.minio_endpoint.startswith("https://")
        self.nats_url = self._require_env("NATS_URL")
        self.metrics_addr = os.getenv("AURORA_METRICS_ADDR", "0.0.0.0:8083")

        # Optional maximum VRAM safety threshold in MB (0 = no limit)
        try:
            self.max_vram_mb = int(os.getenv("AURORA_ML_MAX_VRAM_MB", "0"))
            if self.max_vram_mb < 0:
                self.max_vram_mb = 0
        except ValueError:
            self.max_vram_mb = 0

        # ClickHouse analytical sink (optional)
        self.clickhouse_host = os.getenv("AURORA_CLICKHOUSE_HOST", "clickhouse")
        self.clickhouse_port = int(os.getenv("AURORA_CLICKHOUSE_PORT", "8123"))
        self.clickhouse_user = os.getenv("AURORA_CLICKHOUSE_USER", "default")
        self.clickhouse_password = os.getenv("AURORA_CLICKHOUSE_PASSWORD", "")
        self.clickhouse_database = os.getenv("AURORA_CLICKHOUSE_DATABASE", "aurora")

    def _require_env(self, key: str) -> str:
        val = os.getenv(key)
        if not val:
            raise ValueError(f"Missing required environment variable '{key}'")
        return val

    def log_summary(self):
        print(
            f"[aurora-ml-worker] Config: env={self.env}, log_level={self.log_level}, "
            f"minio={self.minio_endpoint}, nats={self.nats_url}"
        )
