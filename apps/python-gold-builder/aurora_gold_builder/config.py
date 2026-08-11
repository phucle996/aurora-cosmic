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
    batch_size: int
    flush_seconds: float
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

        batch_size = int(os.getenv("AURORA_GOLD_BATCH_SIZE", "100"))
        flush_seconds = float(os.getenv("AURORA_GOLD_FLUSH_SECONDS", "300"))
        if batch_size < 1:
            raise ValueError("AURORA_GOLD_BATCH_SIZE must be positive")
        if flush_seconds <= 0:
            raise ValueError("AURORA_GOLD_FLUSH_SECONDS must be positive")

        return cls(
            environment=required("AURORA_ENV"),
            log_level=required("AURORA_LOG_LEVEL"),
            minio_endpoint=required("MINIO_ENDPOINT"),
            minio_access_key=required("MINIO_ACCESS_KEY"),
            minio_secret_key=required("MINIO_SECRET_KEY"),
            minio_bucket=required("MINIO_BUCKET"),
            nats_url=required("NATS_URL"),
            batch_size=batch_size,
            flush_seconds=flush_seconds,
            durable=os.getenv("AURORA_GOLD_DURABLE", "aurora-gold-builder"),
            stream=os.getenv("AURORA_GOLD_STREAM", "AURORA_SILVER"),
            set_current=os.getenv("AURORA_GOLD_SET_CURRENT", "false").lower()
            in {"1", "true", "yes", "on"},
        )
