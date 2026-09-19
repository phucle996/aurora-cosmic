"""Fine-grained heap allocation, OS kernel diagnostics, and bottleneck profiling for Aurora Enrichment.

Measures:
1. Python allocated heap memory (current, peak, delta/leak, top allocation call sites) via `tracemalloc`.
2. Linux OS-level Resident Set Size (real-time RSS via `/proc/self/statm` and peak RSS via `resource.getrusage`).
3. CPU time distribution: User CPU (`ru_utime`), System/Kernel CPU (`ru_stime`), and CPU Utilization %.
4. OS Kernel Diagnostics:
   - Voluntary Context Switches (`ru_nvcsw`): I/O waits and Lock contention.
   - Involuntary Context Switches (`ru_nivcsw`): CPU preemption and thread starvation.
   - Major Page Faults (`ru_majflt`): Disk paging and swap access (critical for disk memmap).
   - Minor Page Faults (`ru_minflt`): Memory page allocations.
5. Stage / Phase Latency & Memory Breakdown: Tracks duration, % of total, and heap delta per pipeline stage.
6. Per-target Latency Distribution: Percentiles (P50, P90, P99, Max, Min).
7. Automated Root-Cause Bottleneck Classifier.
"""

from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass, field
import gc
import math
import os
from pathlib import Path
import resource
import time
import tracemalloc
from typing import Any, Callable, Generator


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
        # Fallback to getrusage maxrss (Linux returns KiB, Darwin returns bytes)
        ru = resource.getrusage(resource.RUSAGE_SELF)
        return int(ru.ru_maxrss * 1024)


def get_peak_rss_bytes() -> int:
    """Read peak Resident Set Size (RSS) in bytes via getrusage."""
    ru = resource.getrusage(resource.RUSAGE_SELF)
    return int(ru.ru_maxrss * 1024)


@dataclass
class AllocationStat:
    """Detailed call site allocation record from tracemalloc."""

    file_path: str
    line_number: int
    size_bytes: int
    count: int

    def __str__(self) -> str:
        short_path = (
            Path(self.file_path).name
            if not self.file_path.startswith("<")
            else self.file_path
        )
        return (
            f"{short_path}:{self.line_number} -> "
            f"{format_bytes(self.size_bytes)} ({self.count} blocks)"
        )


@dataclass
class PhaseStat:
    """Granular execution and memory profile for one specific pipeline stage."""

    name: str
    duration_seconds: float
    user_cpu_seconds: float
    system_cpu_seconds: float
    peak_heap_bytes: int
    heap_delta_bytes: int
    pct_of_total_duration: float = 0.0

    @property
    def duration_ms(self) -> float:
        return self.duration_seconds * 1000.0

    @property
    def cpu_utilization_pct(self) -> float:
        if self.duration_seconds <= 0:
            return 0.0
        return (
            (self.user_cpu_seconds + self.system_cpu_seconds) / self.duration_seconds
        ) * 100.0

    def summary(self) -> str:
        return (
            f"{self.name:<32} "
            f"{self.duration_ms:>8.1f} ms ({self.pct_of_total_duration:>5.1f}%) | "
            f"CPU: {self.cpu_utilization_pct:>5.1f}% | "
            f"Peak: {format_bytes(self.peak_heap_bytes):>10} | "
            f"Delta: {format_bytes(self.heap_delta_bytes):>10}"
        )


@dataclass
class HeapProfileResult:
    """Captured heap allocation, OS kernel diagnostics, and bottleneck profile."""

    name: str
    duration_seconds: float
    # Python heap allocation via tracemalloc
    start_heap_bytes: int
    peak_heap_bytes: int
    end_heap_bytes: int
    heap_delta_bytes: int
    # OS Resident Set Size
    start_rss_bytes: int
    end_rss_bytes: int
    peak_rss_bytes: int
    rss_delta_bytes: int
    # CPU Time Distribution
    user_cpu_seconds: float = 0.0
    system_cpu_seconds: float = 0.0
    # OS Kernel Diagnostics
    voluntary_context_switches: int = 0
    involuntary_context_switches: int = 0
    major_page_faults: int = 0
    minor_page_faults: int = 0
    # Detailed Stages & Distributions
    phases: list[PhaseStat] = field(default_factory=list)
    per_item_latencies: list[float] = field(default_factory=list)
    # Allocation breakdown
    top_allocations: list[AllocationStat] = field(default_factory=list)
    item_count: int = 0
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def throughput_items_per_second(self) -> float:
        """Calculate throughput if item_count was provided."""
        if self.duration_seconds <= 0 or self.item_count <= 0:
            return 0.0
        return self.item_count / self.duration_seconds

    @property
    def cpu_utilization_pct(self) -> float:
        """Percentage of wall clock time consumed by user + system CPU."""
        if self.duration_seconds <= 0:
            return 0.0
        return min(
            100.0 * os.cpu_count() if os.cpu_count() else 100.0,
            ((self.user_cpu_seconds + self.system_cpu_seconds) / self.duration_seconds)
            * 100.0,
        )

    @property
    def io_wait_seconds(self) -> float:
        """Estimated wall clock time spent waiting on I/O, locks, or idling."""
        cpu_time = self.user_cpu_seconds + self.system_cpu_seconds
        return max(0.0, self.duration_seconds - cpu_time)

    # --- Latency Percentiles (ms) ---
    def _percentile(self, p: float) -> float:
        if not self.per_item_latencies:
            return 0.0
        sorted_lats = sorted(self.per_item_latencies)
        k = (len(sorted_lats) - 1) * p
        f = math.floor(k)
        c = math.ceil(k)
        if f == c:
            return sorted_lats[int(k)] * 1000.0
        d0 = sorted_lats[int(f)] * (c - k)
        d1 = sorted_lats[int(c)] * (k - f)
        return (d0 + d1) * 1000.0

    @property
    def p50_latency_ms(self) -> float:
        return self._percentile(0.50)

    @property
    def p90_latency_ms(self) -> float:
        return self._percentile(0.90)

    @property
    def p99_latency_ms(self) -> float:
        return self._percentile(0.99)

    @property
    def max_latency_ms(self) -> float:
        return max(self.per_item_latencies) * 1000.0 if self.per_item_latencies else 0.0

    @property
    def min_latency_ms(self) -> float:
        return min(self.per_item_latencies) * 1000.0 if self.per_item_latencies else 0.0

    # --- Automated Bottleneck Classification ---
    def identify_bottleneck(self) -> dict[str, Any]:
        """Diagnose root-cause bottleneck based on CPU, I/O, and Stage metrics."""
        category = "UNKNOWN"
        reason = ""
        culprit_stage = ""

        # Identify stage consuming largest fraction of time
        if self.phases:
            top_phase = max(self.phases, key=lambda p: p.duration_seconds)
            culprit_stage = f"{top_phase.name} ({top_phase.pct_of_total_duration:.1f}%)"

        if self.major_page_faults > 10:
            category = "DISK_PAGING_BOUND"
            reason = (
                f"High major page faults ({self.major_page_faults}) indicating heavy "
                "disk swapping or memory-mapped file access latency."
            )
        elif self.cpu_utilization_pct >= 75.0:
            category = "CPU_BOUND"
            reason = (
                f"High CPU utilization ({self.cpu_utilization_pct:.1f}%). "
                f"User CPU: {self.user_cpu_seconds:.2f}s, System: {self.system_cpu_seconds:.2f}s. "
                "Bottleneck is mathematical / algorithm execution."
            )
        elif self.voluntary_context_switches > 50 and self.cpu_utilization_pct < 45.0:
            category = "LOCK_OR_IO_BOUND"
            reason = (
                f"Low CPU ({self.cpu_utilization_pct:.1f}%) with {self.voluntary_context_switches} "
                "voluntary context switches. Worker is blocked waiting on lock acquisition or socket I/O."
            )
        elif self.heap_delta_bytes > 5 * 1024 * 1024:
            category = "MEMORY_LEAK_PRESSURE"
            reason = (
                f"Significant retained heap ({format_bytes(self.heap_delta_bytes)}) "
                "exerting GC pressure."
            )
        else:
            category = "BALANCED_THROUGHPUT"
            reason = "Pipeline operates within balanced CPU and I/O envelopes."

        return {
            "category": category,
            "reason": reason,
            "culprit_stage": culprit_stage,
            "cpu_utilization_pct": self.cpu_utilization_pct,
            "voluntary_switches": self.voluntary_context_switches,
            "major_page_faults": self.major_page_faults,
        }

    def summary(self, include_top_k: int = 3) -> str:
        """Generate formatted multi-section bottleneck and profile report."""
        lines = [
            f"=== Benchmark Profile: {self.name} ===",
            f"  Duration:         {self.duration_seconds * 1000:.2f} ms",
            f"  CPU Utilization:  {self.cpu_utilization_pct:.1f}% "
            f"(User: {self.user_cpu_seconds:.3f}s, System: {self.system_cpu_seconds:.3f}s, Wait: {self.io_wait_seconds:.3f}s)",
            f"  Kernel Context:   Voluntary Switches={self.voluntary_context_switches} (Lock/IO), "
            f"Involuntary={self.involuntary_context_switches}, Major Faults={self.major_page_faults}",
        ]
        if self.item_count > 0:
            lines.append(
                f"  Throughput:       {self.throughput_items_per_second:.1f} items/sec "
                f"({self.item_count} items)"
            )
        if self.per_item_latencies:
            lines.append(
                f"  Target Latencies: P50={self.p50_latency_ms:.1f}ms, P90={self.p90_latency_ms:.1f}ms, "
                f"P99={self.p99_latency_ms:.1f}ms, Max={self.max_latency_ms:.1f}ms"
            )
        lines.extend(
            [
                f"  Allocated Heap:   start={format_bytes(self.start_heap_bytes)}, "
                f"peak={format_bytes(self.peak_heap_bytes)}, "
                f"end={format_bytes(self.end_heap_bytes)}, "
                f"delta={format_bytes(self.heap_delta_bytes)}",
                f"  OS RSS Memory:    start={format_bytes(self.start_rss_bytes)}, "
                f"end={format_bytes(self.end_rss_bytes)}, "
                f"peak={format_bytes(self.peak_rss_bytes)}, "
                f"delta={format_bytes(self.rss_delta_bytes)}",
            ]
        )

        diagnosis = self.identify_bottleneck()
        lines.append(
            f"  Bottleneck Diagnosis: [{diagnosis['category']}] {diagnosis['reason']}"
        )
        if diagnosis["culprit_stage"]:
            lines.append(f"    Primary Culprit Stage: {diagnosis['culprit_stage']}")

        if self.phases:
            lines.append("  Stage Breakdown:")
            for p in self.phases:
                lines.append(f"    • {p.summary()}")

        if self.top_allocations and include_top_k > 0:
            lines.append(f"  Top Allocations (top {include_top_k}):")
            for stat in self.top_allocations[:include_top_k]:
                lines.append(f"    - {stat}")
        return "\n".join(lines)

    def assert_peak_heap_under(self, max_bytes: int) -> None:
        """Assert that peak Python allocated heap did not exceed threshold."""
        if self.peak_heap_bytes > max_bytes:
            raise AssertionError(
                f"[{self.name}] Peak allocated heap exceeded threshold: "
                f"{format_bytes(self.peak_heap_bytes)} > {format_bytes(max_bytes)}"
            )

    def assert_no_leak(self, tolerance_bytes: int = 1024 * 1024) -> None:
        """Assert that heap delta after GC did not retain significant uncollected memory."""
        if self.heap_delta_bytes > tolerance_bytes:
            raise AssertionError(
                f"[{self.name}] Potential memory leak detected: "
                f"heap delta {format_bytes(self.heap_delta_bytes)} "
                f"exceeds tolerance {format_bytes(tolerance_bytes)}"
            )

    def assert_peak_rss_under(self, max_bytes: int) -> None:
        """Assert that peak OS RSS did not exceed threshold."""
        if self.peak_rss_bytes > max_bytes:
            raise AssertionError(
                f"[{self.name}] Peak RSS exceeded threshold: "
                f"{format_bytes(self.peak_rss_bytes)} > {format_bytes(max_bytes)}"
            )


class HeapTracker:
    """Context manager and profiler that tracks Python heap allocation, OS RSS, and stages.

    Example:
        with HeapTracker("TPF Extraction", trace_top_k=5) as tracker:
            with tracker.phase("Parquet Read"):
                ...
            with tracker.phase("BLS Extraction"):
                ...
        print(tracker.result.summary())
    """

    def __init__(
        self,
        name: str = "Benchmark",
        trace_top_k: int = 5,
        force_gc: bool = True,
        item_count: int = 0,
    ):
        self.name = name
        self.trace_top_k = trace_top_k
        self.force_gc = force_gc
        self.item_count = item_count
        self.result: HeapProfileResult | None = None
        self.phases: list[PhaseStat] = []
        self.per_item_latencies: list[float] = []

        self._was_tracing = False
        self._start_time = 0.0
        self._start_heap = 0
        self._start_rss = 0
        self._start_ru: Any = None
        self._start_snapshot: tracemalloc.Snapshot | None = None

    def record_item_latency(self, latency_seconds: float) -> None:
        """Record the latency of a single processed item."""
        self.per_item_latencies.append(latency_seconds)

    @contextmanager
    def phase(self, phase_name: str) -> Generator[None, None, None]:
        """Context manager tracking duration, CPU, and heap delta for a single pipeline stage."""
        phase_start_time = time.perf_counter()
        phase_ru_start = resource.getrusage(resource.RUSAGE_SELF)
        phase_start_heap, _ = (
            tracemalloc.get_traced_memory() if tracemalloc.is_tracing() else (0, 0)
        )
        if tracemalloc.is_tracing():
            tracemalloc.reset_peak()

        try:
            yield
        finally:
            phase_end_time = time.perf_counter()
            phase_ru_end = resource.getrusage(resource.RUSAGE_SELF)
            phase_end_heap, phase_peak_heap = (
                tracemalloc.get_traced_memory() if tracemalloc.is_tracing() else (0, 0)
            )

            phase_duration = max(0.000001, phase_end_time - phase_start_time)
            user_cpu = max(0.0, phase_ru_end.ru_utime - phase_ru_start.ru_utime)
            system_cpu = max(0.0, phase_ru_end.ru_stime - phase_ru_start.ru_stime)

            self.phases.append(
                PhaseStat(
                    name=phase_name,
                    duration_seconds=phase_duration,
                    user_cpu_seconds=user_cpu,
                    system_cpu_seconds=system_cpu,
                    peak_heap_bytes=phase_peak_heap,
                    heap_delta_bytes=phase_end_heap - phase_start_heap,
                )
            )

    def __enter__(self) -> HeapTracker:
        if self.force_gc:
            gc.collect()

        self._was_tracing = tracemalloc.is_tracing()
        if not self._was_tracing:
            tracemalloc.start(25)
        else:
            tracemalloc.reset_peak()

        self._start_ru = resource.getrusage(resource.RUSAGE_SELF)
        self._start_rss = get_current_rss_bytes()
        self._start_heap = tracemalloc.get_traced_memory()[0]
        if self.trace_top_k > 0:
            self._start_snapshot = tracemalloc.take_snapshot()

        self._start_time = time.perf_counter()
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        elapsed = max(0.000001, time.perf_counter() - self._start_time)
        end_ru = resource.getrusage(resource.RUSAGE_SELF)
        curr_heap, peak_heap = tracemalloc.get_traced_memory()
        end_rss = get_current_rss_bytes()
        peak_rss = get_peak_rss_bytes()

        user_cpu = max(0.0, end_ru.ru_utime - self._start_ru.ru_utime)
        system_cpu = max(0.0, end_ru.ru_stime - self._start_ru.ru_stime)
        vol_switches = max(0, end_ru.ru_nvcsw - self._start_ru.ru_nvcsw)
        invol_switches = max(0, end_ru.ru_nivcsw - self._start_ru.ru_nivcsw)
        maj_faults = max(0, end_ru.ru_majflt - self._start_ru.ru_majflt)
        min_faults = max(0, end_ru.ru_minflt - self._start_ru.ru_minflt)

        top_stats: list[AllocationStat] = []
        if self.trace_top_k > 0 and self._start_snapshot is not None:
            end_snapshot = tracemalloc.take_snapshot()
            diffs = end_snapshot.compare_to(self._start_snapshot, "lineno")
            for diff in diffs[: self.trace_top_k]:
                top_stats.append(
                    AllocationStat(
                        file_path=diff.traceback[0].filename,
                        line_number=diff.traceback[0].lineno,
                        size_bytes=diff.size_diff,
                        count=diff.count_diff,
                    )
                )

        if not self._was_tracing:
            tracemalloc.stop()

        if self.force_gc:
            gc.collect()
            post_gc_heap = (
                tracemalloc.get_traced_memory()[0]
                if tracemalloc.is_tracing()
                else curr_heap
            )
        else:
            post_gc_heap = curr_heap

        # Normalize phase percentages
        for phase in self.phases:
            phase.pct_of_total_duration = (phase.duration_seconds / elapsed) * 100.0

        self.result = HeapProfileResult(
            name=self.name,
            duration_seconds=elapsed,
            start_heap_bytes=self._start_heap,
            peak_heap_bytes=peak_heap,
            end_heap_bytes=post_gc_heap,
            heap_delta_bytes=post_gc_heap - self._start_heap,
            start_rss_bytes=self._start_rss,
            end_rss_bytes=end_rss,
            peak_rss_bytes=peak_rss,
            rss_delta_bytes=end_rss - self._start_rss,
            user_cpu_seconds=user_cpu,
            system_cpu_seconds=system_cpu,
            voluntary_context_switches=vol_switches,
            involuntary_context_switches=invol_switches,
            major_page_faults=maj_faults,
            minor_page_faults=min_faults,
            phases=self.phases,
            per_item_latencies=self.per_item_latencies,
            top_allocations=top_stats,
            item_count=self.item_count,
        )


def profile_function(
    func: Callable[..., Any],
    *args: Any,
    name: str = "",
    trace_top_k: int = 5,
    item_count: int = 0,
    **kwargs: Any,
) -> tuple[Any, HeapProfileResult]:
    """Execute function within HeapTracker and return (function_result, profile_result)."""
    tracker_name = name or func.__name__
    with HeapTracker(
        tracker_name, trace_top_k=trace_top_k, item_count=item_count
    ) as tracker:
        result = func(*args, **kwargs)
    assert tracker.result is not None
    return result, tracker.result
