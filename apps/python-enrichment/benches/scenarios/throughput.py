"""Benchmark scenario: End-to-end Throughput & Processing Latency.

Evaluates:
1. End-to-end batch materialization throughput (targets/sec) at different batch scales (e.g. 10, 25 targets).
2. Peak allocated heap scaling per target.
3. ClickHouse projection efficiency and memory footprint.
"""

from __future__ import annotations

import tempfile
import time
from typing import Any

from benches.harness import TestBenchHarness
from benches.profiler import HeapProfileResult, HeapTracker
from pipeline.catalogs import load_active_catalogs
from pipeline.materializer import EnrichmentBuilder
from storage.clickhouse import EnrichmentClickHouseProjector


def run_throughput_benchmark(
    batch_sizes: list[int] | None = None,
) -> list[HeapProfileResult]:
    """Execute end-to-end throughput benchmarks for specified batch sizes."""
    if batch_sizes is None:
        batch_sizes = [5, 15]

    results: list[HeapProfileResult] = []

    for size in batch_sizes:
        harness = TestBenchHarness()
        tic_start = 80000 + (size * 100)
        tic_ids = list(range(tic_start, tic_start + size))
        harness.stage_catalogs(tic_ids)

        batch_events: list[Any] = []
        for tic in tic_ids:
            lc = harness.stage_silver_lightcurve(
                tic, sector=1, cadences=250, inject_transit=True
            )
            tpf = harness.stage_silver_tpf(tic, sector=1, cadences=250, rows=9, cols=9)
            batch_events.extend([lc, tpf])

        with tempfile.TemporaryDirectory(prefix="bench-throughput-scratch-") as scratch:
            builder = EnrichmentBuilder(harness.store, scratch_dir=scratch)
            catalogs = load_active_catalogs(harness.store, harness.bucket)

            with HeapTracker(
                name=f"E2E Throughput ({size} Targets)",
                item_count=size,
                trace_top_k=5,
            ) as tracker:
                with tracker.phase("1. Catalog Load"):
                    catalogs = load_active_catalogs(harness.store, harness.bucket)

                with tracker.phase("2. Light Curve BLS Math"):
                    lc_events = [
                        e for e in batch_events if e.product_kind == "LIGHT_CURVE"
                    ]
                    precomputed_lc = {}
                    for lc_evt in lc_events:
                        t_item = time.perf_counter()
                        feat = builder._lightcurve_features(lc_evt)
                        tracker.record_item_latency(time.perf_counter() - t_item)
                        precomputed_lc[lc_evt.source_product_id] = feat

                with tracker.phase("3. TPF Pixel Evidence"):
                    tpf_events = [
                        e for e in batch_events if e.product_kind == "TARGET_PIXEL"
                    ]
                    precomputed_tpf = {}
                    for tpf_evt in tpf_events:
                        precomputed_tpf[tpf_evt.source_product_id] = builder._tpf_row(
                            tpf_evt, None
                        )

                with tracker.phase("4. Parquet & Manifest Commit"):
                    build_result = builder.build_candidate(
                        batch_events,
                        catalogs=catalogs,
                        set_current=True,
                        precomputed_lc_features=precomputed_lc,
                        precomputed_tpf_rows=precomputed_tpf,
                    )

                with tracker.phase("5. ClickHouse Projection"):
                    projector = EnrichmentClickHouseProjector(
                        harness.config, harness.store, client=harness.clickhouse
                    )
                    rows_projected = projector.project(build_result)

            assert tracker.result is not None
            assert build_result.dataset_row_counts.get("candidate", 0) == size
            assert rows_projected > 0

            tracker.result.metadata = {
                "batch_size": size,
                "rows_projected": rows_projected,
                "manifest_key": build_result.manifest_key,
                "heap_per_target_kib": (
                    (tracker.result.peak_heap_bytes / size) / 1024 if size > 0 else 0.0
                ),
            }
            tracker.result.assert_no_leak(tolerance_bytes=3 * 1024 * 1024)
            results.append(tracker.result)

    return results


if __name__ == "__main__":
    for res in run_throughput_benchmark():
        print(res.summary())
        print("Metadata:", res.metadata)
        print("-" * 60)
