"""CUDA runtime policy shared by every training path.

Training is deliberately CUDA-only.  CPU remains valid for data decoding,
metadata work, and ONNX export, but it must never be selected silently for a
model training run.
"""

from dataclasses import asdict, dataclass
from typing import Any, Dict

import torch


class CudaRequiredError(RuntimeError):
    """Raised when a training run cannot satisfy the CUDA-only policy."""


@dataclass(frozen=True)
class CudaRuntimeInfo:
    device: str
    device_name: str
    capability: str
    total_vram_mb: int
    torch_version: str
    cuda_version: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def require_cuda(device_str: str = "cuda", max_vram_mb: int = 0) -> tuple[torch.device, CudaRuntimeInfo]:
    """Resolve and validate the only supported training device.

    ``auto`` and ``cpu`` are rejected instead of being interpreted as a
    fallback.  ``max_vram_mb`` is an optional per-process allocator cap; zero
    means use the full device.
    """
    normalized = (device_str or "").strip().lower()
    if normalized != "cuda":
        raise CudaRequiredError(
            f"GPU_ONLY_POLICY: training requires AURORA_ML_DEVICE=cuda; got '{device_str}'"
        )
    if not torch.cuda.is_available():
        raise CudaRequiredError(
            "CUDA_UNAVAILABLE: no CUDA device is visible to the ML worker"
        )

    device = torch.device("cuda:0")
    props = torch.cuda.get_device_properties(device)
    total_vram_mb = int(props.total_memory // (1024 * 1024))
    if max_vram_mb < 0:
        raise CudaRequiredError("INVALID_VRAM_LIMIT: max_vram_mb must be >= 0")
    if max_vram_mb and max_vram_mb > total_vram_mb:
        raise CudaRequiredError(
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

    info = CudaRuntimeInfo(
        device=str(device),
        device_name=torch.cuda.get_device_name(device),
        capability=f"{props.major}.{props.minor}",
        total_vram_mb=total_vram_mb,
        torch_version=torch.__version__,
        cuda_version=torch.version.cuda or "unknown",
    )
    return device, info
