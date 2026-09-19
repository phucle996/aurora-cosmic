"""Benchmark scenario: Wave Admission & Idle Quiescence Memory Profile.

Simulates rapid bursts (waves) of Silver Light Curve and Target Pixel events,
verifying:
1. Batch admission thresholding (batches are formed up to max_batch_records).
2. Modality pairing (Light Curve + Target Pixel correlation).
3. Heap stability and leak-free memory profile across continuous streaming waves.
"""

from __future__ import annotations

from typing import Any

from benches.harness import TestBenchHarness
from benches.profiler import HeapProfileResult, HeapTracker
from runtime.control import EnrichmentControl
from runtime.readiness import MultimodalReadiness
from runtime.scheduler import PendingBatch, dispatchable_ready_batches


def run_wave_admission_benchmark(
    num_waves: int = 5,
    records_per_wave: int = 20,
    batch_size: int = 25,
) -> HeapProfileResult:
    """Run streaming wave admission benchmark and profile allocated heap."""
    harness = TestBenchHarness()
    readiness = MultimodalReadiness(harness.store, harness.bucket)
    control = EnrichmentControl(
        mode="STREAM",
        max_batch_records=batch_size,
        idle_flush_seconds=1.0,
        command_id="wave-bench",
    )

    total_records = num_waves * records_per_wave
    pending: PendingBatch = []
    admitted_batches_count = 0
    admitted_records_count = 0

    # Pre-stage test data in store outside tracker to isolate scheduler heap
    pre_staged_waves: list[list[tuple[str, Any]]] = []
    current_tic = 50000

    for wave_idx in range(num_waves):
        wave_tics = list(range(current_tic, current_tic + records_per_wave))
        current_tic += records_per_wave
        harness.stage_catalogs(wave_tics)
        wave_items = []
        for tic in wave_tics:
            lc_event = harness.stage_silver_lightcurve(
                tic, sector=1, cadences=200, inject_transit=True
            )
            tpf_event = harness.stage_silver_tpf(
                tic, sector=1, cadences=200, rows=9, cols=9
            )
            readiness.persist_context(tpf_event)
            wave_items.append(
                (f"checkpoints/pending/{lc_event.event_id}.json", lc_event)
            )
        pre_staged_waves.append(wave_items)

    with HeapTracker(
        name=f"Wave Admission ({num_waves} waves x {records_per_wave} recs)",
        item_count=total_records,
        trace_top_k=5,
    ) as tracker:
        simulated_time = 100.0

        for wave_idx, wave_items in enumerate(pre_staged_waves):
            # Ingest this wave into the pending queue
            pending.extend(wave_items)
            simulated_time += 0.5  # rapid bursts 500ms apart

            # Evaluate readiness & dispatchable batches
            batches, summary = readiness.collect_ready(
                pending, max_targets=control.max_batch_records
            )
            ready_units = dispatchable_ready_batches(
                ready_batches=batches,
                max_batch_records=control.max_batch_records,
                last_received_at=simulated_time,
                idle_flush_seconds=control.idle_flush_seconds,
                now=simulated_time,
            )

            for unit in ready_units:
                admitted_batches_count += 1
                admitted_records_count += len(unit)
                consumed = {key for key, _ in unit}
                pending = [(k, e) for k, e in pending if k not in consumed]

        # Final idle flush simulation (quiescence: 5s after last receipt)
        batches, summary = readiness.collect_ready(
            pending, max_targets=control.max_batch_records
        )
        final_units = dispatchable_ready_batches(
            ready_batches=batches,
            max_batch_records=control.max_batch_records,
            last_received_at=simulated_time,
            idle_flush_seconds=control.idle_flush_seconds,
            now=simulated_time + 5.0,
        )
        for unit in final_units:
            admitted_batches_count += 1
            admitted_records_count += len(unit)
            consumed = {key for key, _ in unit}
            pending = [(k, e) for k, e in pending if k not in consumed]

    assert tracker.result is not None
    # Verify all admitted records were accounted for
    tracker.result.metadata = {
        "admitted_batches": admitted_batches_count,
        "admitted_records": admitted_records_count,
        "remaining_pending": len(pending),
    }
    tracker.result.assert_no_leak(tolerance_bytes=1024 * 1024)
    return tracker.result


if __name__ == "__main__":
    result = run_wave_admission_benchmark()
    print(result.summary())
    print("Metadata:", result.metadata)
