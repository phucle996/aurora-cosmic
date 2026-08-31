"""Explicit CPU/GPU runtime selection shared by every training path."""

from dataclasses import asdict, dataclass
from typing import Any, Dict

import torch


class ComputeTargetError(RuntimeError):
    """Raised when a requested training compute target is unavailable."""


@dataclass(frozen=True)
class TrainingRuntimeInfo:
    device: str
    device_name: str
    capability: str
    total_vram_mb: int
    torch_version: str
    cuda_version: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def resolve_training_device(
    device_str: str = "cuda", max_vram_mb: int = 0
) -> tuple[torch.device, TrainingRuntimeInfo]:
    """Resolve an explicitly requested ``cpu`` or ``gpu`` training branch."""
    normalized = (device_str or "").strip().lower()
    if normalized in ("gpu", "cuda"):
        normalized = "cuda"
    elif normalized == "cpu":
        if max_vram_mb:
            raise ComputeTargetError("CPU_TARGET_REJECTS_VRAM_LIMIT")
        return torch.device("cpu"), TrainingRuntimeInfo(
            device="cpu",
            device_name="Host CPU",
            capability="n/a",
            total_vram_mb=0,
            torch_version=torch.__version__,
            cuda_version="not-used",
        )
    else:
        raise ComputeTargetError(
            f"INVALID_COMPUTE_TARGET: expected cpu or gpu, got '{device_str}'"
        )
    if not torch.cuda.is_available():
        raise ComputeTargetError(
            "CUDA_UNAVAILABLE: no CUDA device is visible to the ML worker"
        )

    device = torch.device("cuda:0")
    props = torch.cuda.get_device_properties(device)
    total_vram_mb = int(props.total_memory // (1024 * 1024))
    if max_vram_mb < 0:
        raise ComputeTargetError("INVALID_VRAM_LIMIT: max_vram_mb must be >= 0")
    if max_vram_mb and max_vram_mb > total_vram_mb:
        raise ComputeTargetError(
            f"VRAM_LIMIT_EXCEEDS_DEVICE: configured {max_vram_mb}MB, device has {total_vram_mb}MB"
        )
    if max_vram_mb:
        torch.cuda.set_per_process_memory_fraction(
            max_vram_mb / total_vram_mb, device=device
        )

    # These settings are safe for the fixed-shape dense models used here and
    # avoid leaving tensor-core performance disabled by default.
    torch.backends.cuda.matmul.allow_tf32 = True
    torch.backends.cudnn.allow_tf32 = True
    torch.backends.cudnn.benchmark = True
    torch.set_float32_matmul_precision("high")
    torch.cuda.manual_seed_all(torch.initial_seed())

    info = TrainingRuntimeInfo(
        device=str(device),
        device_name=torch.cuda.get_device_name(device),
        capability=f"{props.major}.{props.minor}",
        total_vram_mb=total_vram_mb,
        torch_version=torch.__version__,
        cuda_version=torch.version.cuda or "unknown",
    )
    return device, info


# Kept for older CLI integrations; worker jobs use resolve_training_device.
CudaRequiredError = ComputeTargetError


def require_cuda(
    device_str: str = "cuda", max_vram_mb: int = 0
) -> tuple[torch.device, TrainingRuntimeInfo]:
    if (device_str or "").strip().lower() not in ("cuda", "gpu"):
        raise ComputeTargetError(
            f"GPU_ONLY_POLICY: training requires gpu; got '{device_str}'"
        )
    return resolve_training_device(device_str, max_vram_mb)
