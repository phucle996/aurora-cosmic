"""Batch admission and idle quiescence scheduler for multimodal Enrichment.

Controls when eligible batches of Silver data (LC + TPF pairs) are admitted
into the worker concurrency pool. Prevents small fragmentation of immutable
snapshots by holding partial batches until either target size is reached
or upstream ingestion has become quiet (idle flush).
"""

from __future__ import annotations

import time

from events import SilverEvent

# A pending batch is a list of tuples: (object_store_checkpoint_key, SilverEvent)
PendingBatch = list[tuple[str, SilverEvent]]


def dispatchable_ready_batches(
    ready_batches: list[PendingBatch],
    *,
    max_batch_records: int,
    last_received_at: float | None,
    idle_flush_seconds: float,
    now: float | None = None,
) -> list[PendingBatch]:
    """Close full batches immediately and partial batches only after quiescence.

    ``max_batch_records`` is a target batch count, not merely an upper queue limit.
    Silver LC/TPF pairs often arrive from upstream preprocessing in small waves.
    Admitting every tiny wave immediately would produce many fragmented,
    single-record immutable snapshots in MinIO and ClickHouse, defeating the
    performance benefits of batching.

    Algorithm:
    1. Separate batches into:
       - Full: count of Light Curve targets >= max_batch_records
       - Partial: count of Light Curve targets < max_batch_records
    2. Full batches are dispatched immediately to maximize throughput.
    3. Partial batches are held until no new Silver events have been received
       for at least ``idle_flush_seconds`` (quiescence), ensuring the tail
       of a dataset run is never starved or left hanging indefinitely.
    """
    full: list[PendingBatch] = []
    partial: list[PendingBatch] = []

    for batch in ready_batches:
        # Light Curve is the primary unit of candidate evidence;
        # Target Pixel files serve as supporting spatial context.
        target_count = sum(event.product_kind == "LIGHT_CURVE" for _, event in batch)
        if target_count <= 0:
            continue

        if target_count >= max_batch_records:
            full.append(batch)
        else:
            partial.append(batch)

    observed_now = time.monotonic() if now is None else now
    source_quiet = (
        last_received_at is not None
        and observed_now - last_received_at >= idle_flush_seconds
    )

    # Dispatched batches: all full batches immediately + partial batches if source is quiet
    return [*full, *(partial if source_quiet else [])]
