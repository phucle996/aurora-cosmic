import os
import pytest
from aurora_ml.config import Config

def test_valid_config():
    os.environ["AURORA_ML_DEVICE"] = "auto"
    cfg = Config()
    assert cfg.device == "auto"
    assert cfg.batch_size == 32

def test_invalid_device():
    os.environ["AURORA_ML_DEVICE"] = "invalid_device"
    with pytest.raises(ValueError, match="Invalid AURORA_ML_DEVICE"):
        Config()
    os.environ["AURORA_ML_DEVICE"] = "auto"
