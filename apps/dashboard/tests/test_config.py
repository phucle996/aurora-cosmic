import os
import pytest
from config import Config

def test_dashboard_config():
    os.environ["AURORA_DASHBOARD_PORT"] = "8501"
    cfg = Config()
    assert cfg.port == 8501

def test_invalid_dashboard_port():
    os.environ["AURORA_DASHBOARD_PORT"] = "999999"
    with pytest.raises(ValueError):
        Config()
    os.environ["AURORA_DASHBOARD_PORT"] = "8501"
