import os

class Config:
    def __init__(self):
        self.env = os.getenv("AURORA_ENV", "development")
        self.log_level = os.getenv("AURORA_LOG_LEVEL", "info")
        self.minio_endpoint = os.getenv("MINIO_ENDPOINT", "http://minio:9000")
        self.minio_bucket = os.getenv("MINIO_BUCKET", "aurora")
        self.nats_url = os.getenv("NATS_URL", "nats://nats:4222")

        device_raw = os.getenv("AURORA_ML_DEVICE", "auto").lower()
        if device_raw not in ("auto", "cpu", "cuda"):
            raise ValueError(f"Invalid AURORA_ML_DEVICE: '{device_raw}'. Must be 'auto', 'cpu', or 'cuda'.")
        self.device = device_raw

        try:
            self.batch_size = int(os.getenv("AURORA_ML_BATCH_SIZE", "32"))
            if self.batch_size < 1:
                raise ValueError()
        except ValueError:
            raise ValueError("AURORA_ML_BATCH_SIZE must be a positive integer.")

        try:
            self.max_vram_mb = int(os.getenv("AURORA_ML_MAX_VRAM_MB", "3500"))
            if self.max_vram_mb < 0:
                raise ValueError()
        except ValueError:
            raise ValueError("AURORA_ML_MAX_VRAM_MB must be a non-negative integer.")

    def log_summary(self):
        print(f"[aurora-ml-worker] Config: env={self.env}, log_level={self.log_level}, device={self.device}, "
              f"batch_size={self.batch_size}, max_vram_mb={self.max_vram_mb}, minio={self.minio_endpoint}")
