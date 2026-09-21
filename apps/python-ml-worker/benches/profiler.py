"""Fine-grained CPU, Host RAM, OS Kernel & GPU Telemetry Profiler for Aurora ML Worker.

Measures:
1. Python Host Heap Memory:
   - Initial, peak, delta/leak via `tracemalloc`.
2. Linux OS Resident Set Size (RSS):
   - Real-time RSS via `/proc/self/statm` and peak RSS via `getrusage`.
3. CPU Utilization & OS Diagnostics:
   - User CPU (`ru_utime`), Kernel CPU (`ru_stime`), CPU Utilization %.
   - Context switches (`ru_nvcsw` lock/IO wait, `ru_nivcsw` CPU preemption).
   - Page faults (`ru_majflt` disk paging/swap, `ru_minflt` memory page allocation).
4. GPU VRAM & Compute Telemetry:
   - PyTorch CUDA peak allocated VRAM (`torch.cuda.max_memory_allocated`).
   - PyTorch CUDA peak reserved VRAM (`torch.cuda.max_memory_reserved`).
   - VRAM delta/leak across iterations.
   - NVIDIA NVML hardware metrics: GPU Core Utilization %, GPU Memory Utilization %, Temperature.
5. Stage / Phase Latency & Memory Breakdown:
   - Tracks duration and memory impact per execution phase.
6. Automated Root-Cause Bottleneck Classifier:
   - Detects CPU-bound, GPU Compute-bound, GPU Memory-bound (VRAM bottleneck), Host RAM-bound, or I/O-bound.
"""

from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass, field
import gc
import math
import os
import resource
import time
import tracemalloc
from typing import Any, Callable, Generator

import torch

try:
    import pynvml

    HAS_NVML = True
except ImportError:
    HAS_NVML = False


def format_bytes(size_in_bytes: float) -> str:
    """Format byte size into human-readable KiB, MiB, or GiB string."""
    is_negative = size_in_bytes < 0
    size = abs(size_in_bytes)
    sign = "-" if is_negative else ""
    if size < 1024:
        return f"{sign}{size:.0f} B"
    if size < 1024 * 1024:
        return f"{sign}{size / 1024:.2f} KiB"
    if size < 1024 * 1024 * 1024:
        return f"{sign}{size / (1024 * 1024):.2f} MiB"
    return f"{sign}{size / (1024 * 1024 * 1024):.2f} GiB"


def get_current_rss_bytes() -> int:
    """Read Linux /proc/self/statm for real-time Resident Set Size (RSS) in bytes."""
    try:
        page_size = os.sysconf("SC_PAGE_SIZE")
        with open("/proc/self/statm", "r", encoding="utf-8") as file:
            resident_pages = int(file.read().split()[1])
            return resident_pages * page_size
    except Exception:
        ru = resource.getrusage(resource.RUSAGE_SELF)
        return int(ru.ru_maxrss * 1024)


def get_peak_rss_bytes() -> int:
    """Read peak Resident Set Size (RSS) in bytes via getrusage."""
    ru = resource.getrusage(resource.RUSAGE_SELF)
    return int(ru.ru_maxrss * 1024)


@dataclass
class GpuTelemetry:
    """GPU Hardware and VRAM telemetry snapshot."""

    gpu_available: bool = False
    device_name: str = "n/a"
    peak_vram_allocated_bytes: int = 0
    peak_vram_reserved_bytes: int = 0
    vram_allocated_delta_bytes: int = 0
    gpu_utilization_pct: float = 0.0
    gpu_memory_utilization_pct: float = 0.0
    gpu_temp_celsius: int = 0


@dataclass
class MlProfileResult:
    """Consolidated telemetry result containing Host, OS, and GPU metrics."""

    scenario_name: str
    item_count: int
    duration_seconds: float

    # Host Heap
    start_heap_bytes: int
    peak_heap_bytes: int
    heap_delta_bytes: int

    # OS RSS
    start_rss_bytes: int
    peak_rss_bytes: int
    rss_delta_bytes: int

    # CPU
    user_cpu_seconds: float
    system_cpu_seconds: float
    cpu_utilization_pct: float

    # OS Kernel Diagnostics
    voluntary_context_switches: int
    involuntary_context_switches: int
    major_page_faults: int
    minor_page_faults: int

    # GPU Telemetry
    gpu: GpuTelemetry

    # Stage Breakdowns
    stage_latencies: dict[str, float] = field(default_factory=dict)
    stage_heap_deltas: dict[str, int] = field(default_factory=dict)

    # Per-item Latency Percentiles
    percentiles: dict[str, float] = field(default_factory=dict)

    @property
    def throughput_items_per_second(self) -> float:
        """Calculate processing throughput (items/sec or samples/sec)."""
        if self.duration_seconds <= 0 or self.item_count <= 0:
            return 0.0
        return self.item_count / self.duration_seconds

    def identify_bottleneck(self) -> dict[str, str]:
        """Classify primary operational bottleneck across Compute, VRAM, RAM, and I/O."""
        # 1. GPU VRAM Thrashing / Memory Bound
        if self.gpu.gpu_available:
            if self.gpu.peak_vram_allocated_bytes > 3 * 1024 * 1024 * 1024:  # > 3GB
                return {
                    "category": "GPU_VRAM_HIGH",
                    "reason": (
                        f"Peak VRAM allocation ({format_bytes(self.gpu.peak_vram_allocated_bytes)}) "
                        "approaching hardware threshold"
                    ),
                    "action": "Reduce batch_size, enable AMP FP16, or apply gradient accumulation.",
                }
            if self.gpu.gpu_utilization_pct > 80.0:
                return {
                    "category": "GPU_COMPUTE_BOUND",
                    "reason": f"High GPU compute core saturation ({self.gpu.gpu_utilization_pct:.1f}%)",
                    "action": "GPU is efficiently utilized. Scale model capacity or optimize architecture.",
                }

        # 2. Disk Paging / Major Faults
        if self.major_page_faults > 5:
            return {
                "category": "PAGE_FAULTS_DISK_IO",
                "reason": f"Detected {self.major_page_faults} major page faults requiring disk access.",
                "action": "Increase host RAM or optimize memory mapping.",
            }

        # 3. Lock / I/O Contention
        if (
            self.voluntary_context_switches > 500
            and self.cpu_utilization_pct < 40.0
            and self.duration_seconds > 0.1
        ):
            return {
                "category": "LOCK_OR_IO_WAIT",
                "reason": (
                    f"{self.voluntary_context_switches} voluntary context switches with low CPU "
                    f"utilization ({self.cpu_utilization_pct:.1f}%)"
                ),
                "action": "Investigate MinIO/file I/O or threading contention.",
            }

        # 4. Host Memory Leak / High Heap Growth
        if self.heap_delta_bytes > 50 * 1024 * 1024:
            return {
                "category": "HOST_HEAP_GROWTH",
                "reason": f"Net heap growth of {format_bytes(self.heap_delta_bytes)} across scenario",
                "action": "Check for tensor retention or unbounded Python cache collections.",
            }

        # 5. CPU Saturation
        if self.cpu_utilization_pct > 90.0:
            return {
                "category": "CPU_BOUND",
                "reason": f"High CPU core saturation ({self.cpu_utilization_pct:.1f}%)",
                "action": "Offload transforms to GPU or use vectorized operations.",
            }

        return {
            "category": "BALANCED_HEALTHY",
            "reason": "Resource utilization is within balanced operating parameters.",
            "action": "Optimal performance profile.",
        }


class MlProfiler:
    """Context manager for fine-grained execution profiling with GPU support."""

    def __init__(self, scenario_name: str, item_count: int = 1):
        self.scenario_name = scenario_name
        self.item_count = item_count
        self.stage_latencies: dict[str, float] = {}
        self.stage_heap_deltas: dict[str, int] = {}
        self._percentiles: dict[str, float] = {}

        self._gpu_device: torch.device | None = None
        self._nvml_handle: Any | None = None

    def set_percentiles(self, durations_ms: list[float]) -> None:
        """Compute latency percentiles (P50, P90, P99, Min, Max) from measurement list."""
        if not durations_ms:
            return
        sorted_d = sorted(durations_ms)
        n = len(sorted_d)

        def pct(p: float) -> float:
            idx = int(math.ceil(p * n)) - 1
            return sorted_d[max(0, min(idx, n - 1))]

        self._percentiles = {
            "min_ms": round(sorted_d[0], 3),
            "p50_ms": round(pct(0.50), 3),
            "p90_ms": round(pct(0.90), 3),
            "p99_ms": round(pct(0.99), 3),
            "max_ms": round(sorted_d[-1], 3),
        }

    @contextmanager
    def stage(self, name: str) -> Generator[None, None, None]:
        """Track execution time and heap delta for a specific phase/stage."""
        gc.collect()
        t0 = time.perf_counter()
        h0 = tracemalloc.get_traced_memory()[0] if tracemalloc.is_tracing() else 0
        try:
            yield
        finally:
            dur = time.perf_counter() - t0
            h1 = tracemalloc.get_traced_memory()[0] if tracemalloc.is_tracing() else 0
            self.stage_latencies[name] = self.stage_latencies.get(name, 0.0) + dur
            self.stage_heap_deltas[name] = self.stage_heap_deltas.get(name, 0) + (
                h1 - h0
            )

    def run(self, func: Callable[[], Any]) -> MlProfileResult:
        """Execute callable under active profiling and return consolidated result."""
        # 1. Warm-up & Garbage Collection
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            torch.cuda.reset_peak_memory_stats()
            self._gpu_device = torch.device("cuda:0")

        # 2. Init NVML if available
        gpu_name = "n/a"
        if torch.cuda.is_available():
            gpu_name = torch.cuda.get_device_name(0)
            if HAS_NVML:
                try:
                    pynvml.nvmlInit()
                    self._nvml_handle = pynvml.nvmlDeviceGetHandleByIndex(0)
                except Exception:
                    self._nvml_handle = None

        # 3. Capture Initial State
        vram_start = (
            torch.cuda.memory_allocated(self._gpu_device) if self._gpu_device else 0
        )
        ru_start = resource.getrusage(resource.RUSAGE_SELF)
        rss_start = get_current_rss_bytes()

        tracemalloc.start()
        tracemalloc.reset_peak()
        heap_start = tracemalloc.get_traced_memory()[0]
        wall_start = time.perf_counter()

        # 4. Execute Workload
        try:
            func()
        finally:
            wall_end = time.perf_counter()
            heap_end, peak_heap = tracemalloc.get_traced_memory()
            tracemalloc.stop()

            ru_end = resource.getrusage(resource.RUSAGE_SELF)
            rss_end = get_current_rss_bytes()

        # 5. Capture GPU State
        peak_vram_alloc = 0
        peak_vram_res = 0
        vram_delta = 0
        gpu_util = 0.0
        gpu_mem_util = 0.0
        gpu_temp = 0

        if self._gpu_device and torch.cuda.is_available():
            peak_vram_alloc = int(torch.cuda.max_memory_allocated(self._gpu_device))
            peak_vram_res = int(torch.cuda.max_memory_reserved(self._gpu_device))
            vram_end = int(torch.cuda.memory_allocated(self._gpu_device))
            vram_delta = vram_end - vram_start

            if self._nvml_handle:
                try:
                    rates = pynvml.nvmlDeviceGetUtilizationRates(self._nvml_handle)
                    gpu_util = float(rates.gpu)
                    gpu_mem_util = float(rates.memory)
                    gpu_temp = int(
                        pynvml.nvmlDeviceGetTemperature(
                            self._nvml_handle, pynvml.NVML_TEMPERATURE_GPU
                        )
                    )
                except Exception:
                    pass
                finally:
                    try:
                        pynvml.nvmlShutdown()
                    except Exception:
                        pass

        # 6. Calculate CPU Metrics
        wall_sec = max(wall_end - wall_start, 1e-9)
        u_cpu = ru_end.ru_utime - ru_start.ru_utime
        s_cpu = ru_end.ru_stime - ru_start.ru_stime
        total_cpu = max(0.0, u_cpu + s_cpu)
        cpu_util_pct = min(100.0 * (total_cpu / wall_sec), 100.0 * os.cpu_count())

        gpu_telemetry = GpuTelemetry(
            gpu_available=bool(self._gpu_device),
            device_name=gpu_name,
            peak_vram_allocated_bytes=peak_vram_alloc,
            peak_vram_reserved_bytes=peak_vram_res,
            vram_allocated_delta_bytes=vram_delta,
            gpu_utilization_pct=gpu_util,
            gpu_memory_utilization_pct=gpu_mem_util,
            gpu_temp_celsius=gpu_temp,
        )

        return MlProfileResult(
            scenario_name=self.scenario_name,
            item_count=self.item_count,
            duration_seconds=wall_sec,
            start_heap_bytes=heap_start,
            peak_heap_bytes=peak_heap,
            heap_delta_bytes=heap_end - heap_start,
            start_rss_bytes=rss_start,
            peak_rss_bytes=max(get_peak_rss_bytes(), rss_end),
            rss_delta_bytes=rss_end - rss_start,
            user_cpu_seconds=u_cpu,
            system_cpu_seconds=s_cpu,
            cpu_utilization_pct=cpu_util_pct,
            voluntary_context_switches=max(0, ru_end.ru_nvcsw - ru_start.ru_nvcsw),
            involuntary_context_switches=max(0, ru_end.ru_nivcsw - ru_start.ru_nivcsw),
            major_page_faults=max(0, ru_end.ru_majflt - ru_start.ru_majflt),
            minor_page_faults=max(0, ru_end.ru_minflt - ru_start.ru_minflt),
            gpu=gpu_telemetry,
            stage_latencies=self.stage_latencies,
            stage_heap_deltas=self.stage_heap_deltas,
            percentiles=self._percentiles,
        )
