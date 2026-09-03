import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from aurora.gold_builder.application.worker import dispatchable_ready_batches


def _batch(targets: int):
    return [
        (f"pending/lc-{index}.json", SimpleNamespace(product_kind="LIGHT_CURVE"))
        for index in range(targets)
    ]


def test_backlog_admission_holds_partial_wave_until_source_is_quiet():
    partial = _batch(49)

    selected = dispatchable_ready_batches(
        [partial],
        max_batch_records=250,
        last_received_at=100.0,
        idle_flush_seconds=180.0,
        now=279.9,
    )

    assert selected == []


def test_backlog_admission_closes_full_batch_without_idle_delay():
    full = _batch(250)
    partial = _batch(37)

    selected = dispatchable_ready_batches(
        [full, partial],
        max_batch_records=250,
        last_received_at=100.0,
        idle_flush_seconds=180.0,
        now=101.0,
    )

    assert selected == [full]


def test_backlog_admission_flushes_final_partial_after_quiescence():
    partial = _batch(37)

    selected = dispatchable_ready_batches(
        [partial],
        max_batch_records=250,
        last_received_at=100.0,
        idle_flush_seconds=180.0,
        now=280.0,
    )

    assert selected == [partial]
