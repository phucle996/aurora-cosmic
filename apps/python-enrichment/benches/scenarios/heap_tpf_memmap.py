"""Benchmark scenario: TPF Memory Bounding and Heap Allocation.

Verifies:
1. In-memory processing of standard TPF cubes under the 64 MiB limit.
2. Disk-backed np.memmap processing when cubes exceed TPF_IN_MEMORY_CUBE_LIMIT_BYTES.
3. Strict absence of memory leaks (allocated heap delta < 500 KiB across repeated extractions).
"""

from __future__ import annotations

import tempfile

from benches.harness import TestBenchHarness
from benches.profiler import HeapProfileResult, HeapTracker
import pipeline.tpf_features as tpf_mod
from pipeline.tpf_features import extract_tpf_row


def run_heap_tpf_benchmark(
    iterations: int = 5,
    cadences: int = 300,
) -> list[HeapProfileResult]:
    """Execute TPF memory bounding benchmarks and measure allocated heap."""
    results: list[HeapProfileResult] = []
    harness = TestBenchHarness()

    with tempfile.TemporaryDirectory(prefix="bench-tpf-scratch-") as scratch_dir:
        # -------------------------------------------------------------
        # 1. Small In-RAM TPF Cube (Standard 9x9 pixels)
        # -------------------------------------------------------------
        small_event = harness.stage_silver_tpf(
            tic_id=10001,
            cadences=cadences,
            rows=9,
            cols=9,
        )

        with HeapTracker(
            name=f"TPF RAM Extraction ({iterations} iters)",
            item_count=iterations,
            trace_top_k=5,
        ) as tracker:
            for _ in range(iterations):
                row = extract_tpf_row(
                    harness.store, small_event, None, scratch_dir=scratch_dir
                )
                assert row is not None
                assert row["pixel_count"] == 81

        assert tracker.result is not None
        tracker.result.assert_no_leak(tolerance_bytes=512 * 1024)
        results.append(tracker.result)

        # -------------------------------------------------------------
        # 2. Large / Disk Memmap TPF Cube Boundary
        # -------------------------------------------------------------
        # Stage a larger cube (21x21 pixels = 441 pixels/cadence)
        # We test the memmap threshold activation and verify that heap allocation
        # does NOT retain the cube array in Python heap memory.
        large_event = harness.stage_silver_tpf(
            tic_id=10002,
            cadences=cadences,
            rows=21,
            cols=21,
        )

        orig_limit = tpf_mod.TPF_IN_MEMORY_CUBE_LIMIT_BYTES
        # Set limit to 200 KiB to trigger memmap logic deterministically
        tpf_mod.TPF_IN_MEMORY_CUBE_LIMIT_BYTES = 200 * 1024
        try:
            with HeapTracker(
                name=f"TPF Memmap Extraction ({iterations} iters)",
                item_count=iterations,
                trace_top_k=5,
            ) as tracker_memmap:
                for _ in range(iterations):
                    row = extract_tpf_row(
                        harness.store, large_event, None, scratch_dir=scratch_dir
                    )
                    assert row is not None
                    assert row["pixel_count"] == 441

            assert tracker_memmap.result is not None
            tracker_memmap.result.assert_no_leak(tolerance_bytes=512 * 1024)
            results.append(tracker_memmap.result)
        finally:
            tpf_mod.TPF_IN_MEMORY_CUBE_LIMIT_BYTES = orig_limit

    return results


if __name__ == "__main__":
    for res in run_heap_tpf_benchmark():
        print(res.summary())
        print("-" * 60)
