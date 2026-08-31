import torch

from aurora_ml.ml.device import resolve_training_device


def test_explicit_cpu_target_is_available_without_cuda():
    device, info = resolve_training_device("cpu")

    assert device == torch.device("cpu")
    assert info.device == "cpu"
    assert info.total_vram_mb == 0
