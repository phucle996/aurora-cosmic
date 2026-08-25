from dataclasses import dataclass
import os


@dataclass(frozen=True)
class Config:
    environment: str
    log_level: str
    minio_endpoint: str
    minio_access_key: str
    minio_secret_key: str
    minio_bucket: str
    nats_url: str
    max_batch_size: int
    flush_seconds: float
    worker_concurrency: int
    durable: str
    stream: str
    set_current: bool

    @classmethod
    def from_env(cls) -> "Config":
        def required(key: str) -> str:
            value = os.getenv(key, "").strip()
            if not value:
                raise ValueError(f"Missing required environment variable '{key}'")
            return value

        max_batch_size = int(
            os.getenv(
                "AURORA_GOLD_MAX_BATCH_SIZE",
                os.getenv("AURORA_GOLD_BATCH_SIZE", "5000"),
            )
        )
        flush_seconds = float(os.getenv("AURORA_GOLD_FLUSH_SECONDS", "300"))
        worker_concurrency = int(os.getenv("AURORA_GOLD_WORKER_CONCURRENCY", "2"))
        if max_batch_size < 1:
            raise ValueError("AURORA_GOLD_MAX_BATCH_SIZE must be positive")
        if flush_seconds <= 0:
            raise ValueError("AURORA_GOLD_FLUSH_SECONDS must be positive")
        if worker_concurrency < 1:
            raise ValueError("AURORA_GOLD_WORKER_CONCURRENCY must be positive")

        return cls(
            environment=required("AURORA_ENV"),
            log_level=required("AURORA_LOG_LEVEL"),
            minio_endpoint=required("MINIO_ENDPOINT"),
            minio_access_key=required("MINIO_ACCESS_KEY"),
            minio_secret_key=required("MINIO_SECRET_KEY"),
            minio_bucket=required("MINIO_BUCKET"),
            nats_url=required("NATS_URL"),
            max_batch_size=max_batch_size,
            flush_seconds=flush_seconds,
            worker_concurrency=worker_concurrency,
            durable=os.getenv("AURORA_GOLD_DURABLE", "aurora-gold-builder"),
            stream=os.getenv("AURORA_GOLD_STREAM", "AURORA_SILVER"),
            set_current=os.getenv("AURORA_GOLD_SET_CURRENT", "false").lower()
            in {"1", "true", "yes", "on"},
        )
