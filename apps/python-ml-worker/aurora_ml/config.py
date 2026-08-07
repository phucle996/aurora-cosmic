import os

class Config:
    def __init__(self):
        self.env = self._require_env("AURORA_ENV")
        self.log_level = self._require_env("AURORA_LOG_LEVEL")
        self.minio_endpoint = self._require_env("MINIO_ENDPOINT")
        self.minio_bucket = self._require_env("MINIO_BUCKET")
        self.nats_url = self._require_env("NATS_URL")

        self.device = self._require_env("AURORA_ML_DEVICE").lower()
        if self.device not in ("auto", "cpu", "cuda"):
            raise ValueError(f"Invalid AURORA_ML_DEVICE: '{self.device}'. Must be 'auto', 'cpu', or 'cuda'")

        try:
            self.batch_size = int(self._require_env("AURORA_ML_BATCH_SIZE"))
            if self.batch_size < 1:
                raise ValueError()
        except ValueError:
            raise ValueError("AURORA_ML_BATCH_SIZE must be a positive integer.")

        try:
            self.max_vram_mb = int(self._require_env("AURORA_ML_MAX_VRAM_MB"))
            if self.max_vram_mb < 0:
                raise ValueError()
        except ValueError:
            raise ValueError("AURORA_ML_MAX_VRAM_MB must be a non-negative integer.")

    def _require_env(self, key: str) -> str:
        val = os.getenv(key)
        if not val:
            raise ValueError(f"Missing required environment variable '{key}'")
        return val

    def log_summary(self):
        print(f"[aurora-ml-worker] Config: env={self.env}, log_level={self.log_level}, device={self.device}, batch_size={self.batch_size}, vram={self.max_vram_mb}MB")
