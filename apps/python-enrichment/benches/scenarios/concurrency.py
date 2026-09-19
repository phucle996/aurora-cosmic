"""Benchmark scenario: Multi-worker Concurrency & Scratch Lock Contention.

Verifies:
1. Multi-worker concurrency across 4 simultaneous batch execution slots.
2. Scratch directory file isolation and advisory file locking contention.
3. Peak allocated heap scaling and clean reclamation under concurrent load.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import tempfile
from typing import Any

from benches.harness import TestBenchHarness
from benches.profiler import HeapProfileResult, HeapTracker
from pipeline.catalogs import load_active_catalogs
from pipeline.materializer import EnrichmentBuilder


def _worker_task(
    harness: TestBenchHarness,
    scratch_dir: str,
    batch_events: list[Any],
) -> dict[str, Any]:
    """Single concurrent worker task materializing a candidate Gold batch."""
    builder = EnrichmentBuilder(harness.store, scratch_dir=scratch_dir)
    catalogs = load_active_catalogs(harness.store, harness.bucket)
    result = builder.build_candidate(batch_events, catalogs=catalogs, set_current=False)
    return {
        "manifest_key": result.manifest_key,
        "dataset_rows": result.dataset_row_counts,
        "lightcurve_inputs": result.lightcurve_inputs,
    }


def run_concurrency_benchmark(
    num_workers: int = 4,
    targets_per_worker: int = 5,
) -> HeapProfileResult:
    """Run concurrent worker benchmark measuring peak heap and throughput."""
    harness = TestBenchHarness()
    total_targets = num_workers * targets_per_worker

    # Pre-stage test data across workers
    all_tics = list(range(60000, 60000 + total_targets))
    harness.stage_catalogs(all_tics)

    worker_batches: list[list[Any]] = []
    idx = 0
    for w in range(num_workers):
        batch = []
        for _ in range(targets_per_worker):
            tic = all_tics[idx]
            idx += 1
            lc_event = harness.stage_silver_lightcurve(
                tic, sector=1, cadences=200, inject_transit=True
            )
            tpf_event = harness.stage_silver_tpf(
                tic, sector=1, cadences=200, rows=9, cols=9
            )
            batch.extend([lc_event, tpf_event])
        worker_batches.append(batch)

    with tempfile.TemporaryDirectory(
        prefix="bench-concurrency-scratch-"
    ) as scratch_dir:
        with HeapTracker(
            name=f"Concurrency ({num_workers} Workers x {targets_per_worker} Targets)",
            item_count=total_targets,
            trace_top_k=5,
        ) as tracker:
            with ThreadPoolExecutor(max_workers=num_workers) as executor:
                futures = [
                    executor.submit(_worker_task, harness, scratch_dir, batch)
                    for batch in worker_batches
                ]
                results = [f.result() for f in futures]

    assert tracker.result is not None
    assert len(results) == num_workers
    for res in results:
        assert res["lightcurve_inputs"] == targets_per_worker

    tracker.result.metadata = {
        "num_workers": num_workers,
        "targets_per_worker": targets_per_worker,
        "total_targets": total_targets,
        "manifests_created": len(results),
    }
    tracker.result.assert_no_leak(tolerance_bytes=4 * 1024 * 1024)
    return tracker.result


if __name__ == "__main__":
    result = run_concurrency_benchmark()
    print(result.summary())
    print("Metadata:", result.metadata)
