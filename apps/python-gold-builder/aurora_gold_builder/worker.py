"""Durable Silver-event consumer for Gold Builder."""

from __future__ import annotations

import asyncio
from concurrent.futures import ProcessPoolExecutor
import json
import logging
import time

from .builder import GoldBuilder
from .config import Config
from .events import SilverEvent
from .store import MinioObjectStore

LOGGER = logging.getLogger("aurora-gold-builder")
PendingBatch = list[tuple[str, SilverEvent]]


def _drain_full_batches(
    pending: PendingBatch, max_batch_size: int
) -> list[PendingBatch]:
    """Move only full batches to workers; the final partial batch waits for idle."""
    batches: list[PendingBatch] = []
    while len(pending) >= max_batch_size:
        batches.append(pending[:max_batch_size])
        del pending[:max_batch_size]
    return batches


def _materialize_candidate(config: Config, events: list[SilverEvent]):
    """Run CPU-heavy feature extraction outside the NATS event-loop process."""
    builder = GoldBuilder(
        store=MinioObjectStore(
            config.minio_endpoint, config.minio_access_key, config.minio_secret_key
        ),
        default_bucket=config.minio_bucket,
    )
    return builder.build_candidate(events, set_current=config.set_current)


async def run_worker(config: Config) -> None:
    import nats
    from nats.errors import TimeoutError as NatsTimeoutError

    logging.basicConfig(level=getattr(logging, config.log_level.upper(), logging.INFO))

    def new_builder() -> GoldBuilder:
        return GoldBuilder(
            store=MinioObjectStore(
                config.minio_endpoint, config.minio_access_key, config.minio_secret_key
            ),
            default_bucket=config.minio_bucket,
        )

    checkpoint_builder = new_builder()
    nc = await nats.connect(config.nats_url)
    try:
        js = nc.jetstream()
        subscription = None
        while subscription is None:
            try:
                subscription = await js.pull_subscribe(
                    "aurora.v1.silver.>",
                    durable=config.durable,
                    stream=config.stream,
                )
            except Exception as exc:
                LOGGER.warning(
                    "Silver stream %s is not ready yet: %s; retrying",
                    config.stream,
                    exc,
                )
                await asyncio.sleep(5)
        try:
            await js.add_stream(
                name="AURORA_GOLD",
                subjects=["aurora.v1.gold.>"],
            )
        except Exception:
            # The stream already exists on normal restarts. Publishing still
            # remains safe because the existing stream owns this subject.
            pass
        pending = checkpoint_builder.pending_events(config.minio_bucket)
        last_received_at = time.monotonic()
        batch_queue: asyncio.Queue[PendingBatch] = asyncio.Queue(
            maxsize=config.worker_concurrency * 2
        )
        build_executor = ProcessPoolExecutor(max_workers=config.worker_concurrency)
        publish_lock = asyncio.Lock()

        async def build_batch(worker_id: int) -> None:
            while True:
                batch = await batch_queue.get()
                try:
                    events = [event for _, event in batch]
                    result = await asyncio.get_running_loop().run_in_executor(
                        build_executor, _materialize_candidate, config, events
                    )
                    payload = json.dumps(
                        {
                            "event_type": "gold.snapshot.committed",
                            "snapshot_id": result.snapshot_id,
                            "snapshot_fingerprint": result.snapshot_fingerprint,
                            "manifest_key": result.manifest_key,
                            "manifest_sha256": result.manifest_sha256,
                            "row_count": result.row_count,
                            "artifact_count": result.artifact_count,
                        },
                        sort_keys=True,
                    ).encode()
                    async with publish_lock:
                        await js.publish("aurora.v1.gold.candidate.committed", payload)
                        await nc.flush()
                    await asyncio.to_thread(new_builder().clear_pending, batch)
                    LOGGER.info(
                        "Committed Gold snapshot %s (worker=%d inputs=%d)",
                        result.snapshot_id,
                        worker_id,
                        len(batch),
                    )
                except Exception:
                    LOGGER.exception(
                        "Gold batch failed; durable checkpoints are retained for retry (worker=%d inputs=%d)",
                        worker_id,
                        len(batch),
                    )
                    await asyncio.sleep(5)
                    await batch_queue.put(batch)
                finally:
                    batch_queue.task_done()

        workers = [
            asyncio.create_task(build_batch(worker_id))
            for worker_id in range(1, config.worker_concurrency + 1)
        ]

        async def enqueue(batch: PendingBatch) -> None:
            if batch:
                await batch_queue.put(batch)

        LOGGER.info(
            "Gold Builder listening: stream=%s durable=%s recovered=%d max_batch=%d idle_flush=%.1fs workers=%d",
            config.stream,
            config.durable,
            len(pending),
            config.max_batch_size,
            config.flush_seconds,
            config.worker_concurrency,
        )

        try:
            for batch in _drain_full_batches(pending, config.max_batch_size):
                await enqueue(batch)

            while True:
                try:
                    messages = await subscription.fetch(batch=100, timeout=1)
                except NatsTimeoutError:
                    messages = []
                for message in messages:
                    try:
                        event = SilverEvent.from_dict(
                            json.loads(message.data.decode("utf-8"))
                        )
                        checkpoint_builder.save_pending(event)
                        await message.ack()
                        pending.append(
                            (
                                f"checkpoints/gold-builder/pending/{event.event_id}.json",
                                event,
                            )
                        )
                        last_received_at = time.monotonic()
                    except Exception:
                        LOGGER.exception(
                            "Failed to persist Silver event; message will retry"
                        )
                        await message.nak()
                if messages:
                    await nc.flush()

                for batch in _drain_full_batches(pending, config.max_batch_size):
                    await enqueue(batch)
                if (
                    pending
                    and time.monotonic() - last_received_at >= config.flush_seconds
                ):
                    await enqueue(pending[:])
                    pending.clear()
        finally:
            for worker in workers:
                worker.cancel()
            await asyncio.gather(*workers, return_exceptions=True)
            build_executor.shutdown(wait=False, cancel_futures=True)
    finally:
        await nc.drain()
