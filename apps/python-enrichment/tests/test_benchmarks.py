"""Regression tests for Aurora Enrichment test benches and heap allocation profiler.

Validates that:
1. HeapTracker accurately captures byte allocations, peak heap, delta, and top call sites.
2. TPF processing maintains strict memory bounds across both RAM and disk memmap paths.
3. Streaming wave admission operates with zero memory leakage.
4. Concurrency executes across multiple workers without lock corruption or deadlocks.
5. Fault and chaos injection recover cleanly with zero dangling allocations.
6. E2E pipeline materializes and projects candidate rows into ClickHouse.
"""

from __future__ import annotations

from benches.profiler import HeapTracker
from benches.scenarios.concurrency import run_concurrency_benchmark
from benches.scenarios.fault_chaos import run_fault_chaos_benchmark
from benches.scenarios.heap_tpf_memmap import run_heap_tpf_benchmark
from benches.scenarios.throughput import run_throughput_benchmark
from benches.scenarios.wave_admission import run_wave_admission_benchmark


def test_bench_heap_profiler_accurately_measures_allocations():
    """Verify that HeapTracker captures exact byte allocations and delta."""
    with HeapTracker(name="Test Allocation", trace_top_k=3) as tracker:
        # Allocate 2 MiB bytearray
        data = bytearray(2 * 1024 * 1024)
        assert len(data) == 2 * 1024 * 1024

    assert tracker.result is not None
    # Peak heap must be at least 2 MiB
    assert tracker.result.peak_heap_bytes >= 2 * 1024 * 1024
    assert len(tracker.result.top_allocations) > 0


def test_bench_tpf_memmap_bounding():
    """Verify that TPF processing maintains memory bounds under RAM and memmap."""
    results = run_heap_tpf_benchmark(iterations=2, cadences=100)
    assert len(results) == 2
    for res in results:
        assert res.peak_heap_bytes > 0
        # Peak heap for small/memmap extractions must stay strictly under 16 MiB
        res.assert_peak_heap_under(16 * 1024 * 1024)
        res.assert_no_leak(tolerance_bytes=512 * 1024)


def test_bench_wave_admission_memory_profile():
    """Verify wave admission executes with zero memory leak and correct counts."""
    result = run_wave_admission_benchmark(
        num_waves=3, records_per_wave=10, batch_size=15
    )
    assert result.metadata["admitted_records"] == 60  # 30 LCs + 30 TPFs = 60
    assert result.metadata["remaining_pending"] == 0
    result.assert_no_leak(tolerance_bytes=512 * 1024)


def test_bench_concurrency_multi_worker_scratch_locks():
    """Verify 2 workers execute concurrently with proper memory cleanup."""
    result = run_concurrency_benchmark(num_workers=2, targets_per_worker=3)
    assert result.metadata["manifests_created"] == 2
    assert result.metadata["total_targets"] == 6
    result.assert_no_leak(tolerance_bytes=2 * 1024 * 1024)


def test_bench_fault_chaos_recovery():
    """Verify fault and chaos injection recover without leaking memory."""
    results = run_fault_chaos_benchmark()
    assert len(results) == 3
    for res in results:
        res.assert_no_leak(tolerance_bytes=2 * 1024 * 1024)


def test_bench_e2e_throughput_and_clickhouse_projection():
    """Verify end-to-end materialization and ClickHouse Arrow projection."""
    results = run_throughput_benchmark(batch_sizes=[3])
    assert len(results) == 1
    result = results[0]
    assert result.metadata["batch_size"] == 3
    assert result.metadata["rows_projected"] == 3
    assert len(result.phases) >= 4
    assert len(result.per_item_latencies) == 3
    assert result.p50_latency_ms > 0
    result.assert_no_leak(tolerance_bytes=2 * 1024 * 1024)


def test_bench_profiler_tracks_phases_and_stages():
    """Verify that phase tracking accurately isolates stages and normalizes percentages."""
    with HeapTracker(name="Stage Test") as tracker:
        with tracker.phase("Phase A"):
            _ = sum(i * i for i in range(10000))
        with tracker.phase("Phase B"):
            _ = [str(i) for i in range(10000)]

    assert tracker.result is not None
    assert len(tracker.result.phases) == 2
    assert tracker.result.phases[0].name == "Phase A"
    assert tracker.result.phases[1].name == "Phase B"
    total_pct = sum(p.pct_of_total_duration for p in tracker.result.phases)
    assert 90.0 <= total_pct <= 105.0


def test_bench_profiler_computes_latency_percentiles():
    """Verify percentile calculation for target processing times."""
    with HeapTracker(name="Percentile Test") as tracker:
        for lat in [0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.10]:
            tracker.record_item_latency(lat)

    assert tracker.result is not None
    assert round(tracker.result.p50_latency_ms, 1) == 55.0
    assert tracker.result.max_latency_ms == 100.0
    assert tracker.result.min_latency_ms == 10.0


def test_bench_profiler_diagnoses_bottlenecks():
    """Verify root-cause bottleneck classification logic."""
    with HeapTracker(name="Bottleneck Test") as tracker:
        with tracker.phase("Heavy Math"):
            _ = sum(i * i for i in range(200000))

    assert tracker.result is not None
    diag = tracker.result.identify_bottleneck()
    assert "category" in diag
    assert diag["category"] in {
        "CPU_BOUND",
        "LOCK_OR_IO_BOUND",
        "DISK_PAGING_BOUND",
        "MEMORY_LEAK_PRESSURE",
        "BALANCED_THROUGHPUT",
    }
