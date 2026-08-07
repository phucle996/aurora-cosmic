import os

import pytest

from aurora_ml.config import Config


def set_dummy_env():
    os.environ["AURORA_ENV"] = "development"
    os.environ["AURORA_LOG_LEVEL"] = "info"
    os.environ["MINIO_ENDPOINT"] = "http://minio:9000"
    os.environ["MINIO_BUCKET"] = "aurora"
    os.environ["NATS_URL"] = "nats://nats:4222"
    os.environ["AURORA_ML_DEVICE"] = "auto"
    os.environ["AURORA_ML_BATCH_SIZE"] = "32"
    os.environ["AURORA_ML_MAX_VRAM_MB"] = "3500"


def test_valid_config():
    set_dummy_env()
    cfg = Config()
    assert cfg.device == "auto"
    assert cfg.batch_size == 32


def test_missing_env():
    set_dummy_env()
    del os.environ["AURORA_ENV"]
    with pytest.raises(ValueError, match="Missing required environment variable"):
        Config()
