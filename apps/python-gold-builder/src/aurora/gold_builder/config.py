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
    clickhouse_host: str
    clickhouse_port: int
    clickhouse_user: str
    clickhouse_password: str
    clickhouse_database: str
    worker_concurrency: int
    scratch_dir: str
    durable: str
    stream: str

    @classmethod
    def from_env(cls) -> "Config":
        def required(key: str) -> str:
            value = os.getenv(key, "").strip()
            if not value:
                raise ValueError(f"Missing required environment variable '{key}'")
            return value

        worker_concurrency = int(os.getenv("AURORA_GOLD_WORKER_CONCURRENCY", "2"))
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
            clickhouse_host=required("AURORA_CLICKHOUSE_HOST"),
            clickhouse_port=int(os.getenv("AURORA_CLICKHOUSE_PORT", "8123")),
            clickhouse_user=required("AURORA_CLICKHOUSE_USER"),
            clickhouse_password=required("AURORA_CLICKHOUSE_PASSWORD"),
            clickhouse_database=os.getenv("AURORA_CLICKHOUSE_DATABASE", "aurora"),
            worker_concurrency=worker_concurrency,
            scratch_dir=os.getenv(
                "AURORA_GOLD_SCRATCH_DIR", ".runtime/gold-builder-scratch"
            ),
            durable=os.getenv("AURORA_GOLD_DURABLE", "aurora-gold-builder"),
            stream=os.getenv("AURORA_GOLD_STREAM", "AURORA_SILVER"),
        )
