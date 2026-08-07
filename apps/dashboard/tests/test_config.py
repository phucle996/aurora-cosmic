import os
import pytest
from config import Config

def set_dummy_env():
    os.environ["AURORA_ENV"] = "development"
    os.environ["AURORA_LOG_LEVEL"] = "info"
    os.environ["AURORA_DASHBOARD_HOST"] = "0.0.0.0"
    os.environ["AURORA_DASHBOARD_PORT"] = "8501"
    os.environ["AURORA_API_URL"] = "http://go-api:8080"

def test_dashboard_config():
    set_dummy_env()
    cfg = Config()
    assert cfg.port == 8501

def test_missing_env():
    set_dummy_env()
    del os.environ["AURORA_ENV"]
    with pytest.raises(ValueError, match="Missing required environment variable"):
        Config()
