import os

import pytest

from config import Config


def set_dummy_env():
    os.environ["AURORA_ENV"] = "development"
    os.environ["AURORA_LOG_LEVEL"] = "info"
    os.environ["MINIO_ENDPOINT"] = "http://minio:9000"
    os.environ["MINIO_BUCKET"] = "aurora"
    os.environ["MINIO_ACCESS_KEY"] = "minioadmin"
    os.environ["MINIO_SECRET_KEY"] = "minioadmin"
    os.environ["NATS_URL"] = "nats://nats:4222"


def test_valid_config():
    set_dummy_env()
    cfg = Config()
    assert cfg.env == "development"
    assert cfg.minio_bucket == "aurora"
    assert cfg.nats_url == "nats://nats:4222"
    assert cfg.metrics_addr == "0.0.0.0:8083"


def test_missing_env():
    set_dummy_env()
    del os.environ["AURORA_ENV"]
    with pytest.raises(ValueError, match="Missing required environment variable 'AURORA_ENV'"):
        Config()
