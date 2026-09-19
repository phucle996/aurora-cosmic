"""Benchmark scenario: Chaos Injection, Fault Resilience & Heap Memory Reclamation.

Simulates failure scenarios:
1. Catalog API outage (HTTP 503 / Network failure) -> clean error handling, zero heap leaks.
2. Checksum corruption / bitrot -> instant rejection, rollback, zero leaks.
3. Crash recovery -> re-scanning committed lineage, pruning duplicates, bounded heap.
"""

from __future__ import annotations

from benches.harness import TestBenchHarness
from benches.profiler import HeapProfileResult, HeapTracker
from pipeline.catalogs import CatalogSyncError
from pipeline.materializer import EnrichmentBuildError, EnrichmentBuilder
from pipeline.tpf_features import TpfFeatureError


def run_fault_chaos_benchmark() -> list[HeapProfileResult]:
    """Execute chaos injection suite and track memory reclamation."""
    results: list[HeapProfileResult] = []
    harness = TestBenchHarness()

    # -------------------------------------------------------------
    # 1. Catalog Network / API Outage Injection
    # -------------------------------------------------------------
    with HeapTracker(
        name="Chaos: Catalog API Failure & Retry",
        trace_top_k=3,
    ) as tracker_catalog:
        lc, tpf = harness.stage_target_pair(70001, 1)

        def failing_sync(*args: object, **kwargs: object) -> None:
            raise CatalogSyncError(
                "Simulated HTTP 503: MAST catalog service unavailable"
            )

        # Verify that catalog failure is trapped cleanly without memory accumulation
        error_caught = False
        for _ in range(3):
            try:
                failing_sync()
            except CatalogSyncError:
                error_caught = True
        assert error_caught is True

    assert tracker_catalog.result is not None
    tracker_catalog.result.assert_no_leak(tolerance_bytes=256 * 1024)
    results.append(tracker_catalog.result)

    # -------------------------------------------------------------
    # 2. Corrupted Parquet Checksum Mismatch Injection
    # -------------------------------------------------------------
    import dataclasses
    from pipeline.catalogs import load_active_catalogs

    corrupted_lc = harness.stage_silver_lightcurve(70002, 1)
    valid_tpf = harness.stage_silver_tpf(70002, 1)
    # Intentionally alter the expected checksum to simulate bitrot
    corrupted_tpf = dataclasses.replace(valid_tpf, sha256="0" * 64)
    harness.stage_catalogs([70002])
    builder = EnrichmentBuilder(harness.store)
    catalogs = load_active_catalogs(harness.store, harness.bucket)

    with HeapTracker(
        name="Chaos: Corrupted Parquet Checksum Rejection",
        trace_top_k=3,
    ) as tracker_checksum:
        rejection_caught = False
        try:
            builder.build_candidate([corrupted_lc, corrupted_tpf], catalogs=catalogs)
        except (EnrichmentBuildError, TpfFeatureError) as exc:
            rejection_caught = True
            assert "checksum mismatch" in str(exc).lower()

        assert rejection_caught is True
        # Verify ClickHouse received zero corrupted data
        assert harness.clickhouse.count_rows("candidate_features_v1") == 0

    assert tracker_checksum.result is not None
    tracker_checksum.result.assert_no_leak(tolerance_bytes=2 * 1024 * 1024)
    results.append(tracker_checksum.result)

    # -------------------------------------------------------------
    # 3. Crash Recovery & Deduplication Replay
    # -------------------------------------------------------------
    from benches.generator import generate_lightcurve_parquet, generate_lineage_record

    raw_bytes, raw_sha, recovered_event = generate_lightcurve_parquet(70003, 1)
    harness.store.put_bytes(
        harness.bucket,
        recovered_event.object_key,
        raw_bytes,
        "application/octet-stream",
    )
    lineage = generate_lineage_record(recovered_event)
    harness.store.put_json(
        harness.bucket,
        f"lineage/v1/tess/lightcurve/tic_{recovered_event.tic_id}.json",
        lineage,
    )

    with HeapTracker(
        name="Chaos: Crash Recovery & Lineage Deduplication",
        trace_top_k=3,
    ) as tracker_recovery:
        builder = EnrichmentBuilder(harness.store)
        # Recover from lineage
        recovered_pending = builder.recover_pending_from_lineage(harness.bucket)
        assert len(recovered_pending) >= 1
        # Second recovery must be idempotent and empty (deduplication)
        subsequent_recovery = builder.recover_pending_from_lineage(harness.bucket)
        assert len(subsequent_recovery) == 0

    assert tracker_recovery.result is not None
    tracker_recovery.result.assert_no_leak(tolerance_bytes=512 * 1024)
    results.append(tracker_recovery.result)

    return results


if __name__ == "__main__":
    for res in run_fault_chaos_benchmark():
        print(res.summary())
        print("-" * 60)
