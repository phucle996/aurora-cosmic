"""Durable Silver-event consumer for Gold Builder."""

from __future__ import annotations

import asyncio
import json
import logging
import time

from .builder import GoldBuilder
from .config import Config
from .events import SilverEvent
from .store import MinioObjectStore

LOGGER = logging.getLogger("aurora-gold-builder")


async def run_worker(config: Config) -> None:
    import nats
    from nats.errors import TimeoutError as NatsTimeoutError

    logging.basicConfig(level=getattr(logging, config.log_level.upper(), logging.INFO))
    store = MinioObjectStore(
        config.minio_endpoint, config.minio_access_key, config.minio_secret_key
    )
    builder = GoldBuilder(store=store, default_bucket=config.minio_bucket)
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
        pending = builder.pending_events(config.minio_bucket)
        last_flush = time.monotonic()
        LOGGER.info(
            "Gold Builder listening: stream=%s durable=%s pending=%d",
            config.stream,
            config.durable,
            len(pending),
        )

        async def flush() -> None:
            nonlocal pending, last_flush
            if not pending:
                return
            events = [event for _, event in pending]
            result = builder.build_candidate(events, set_current=config.set_current)
            await js.publish(
                "aurora.v1.gold.candidate.committed",
                json.dumps(
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
                ).encode(),
            )
            await nc.flush()
            builder.clear_pending(pending)
            pending = []
            last_flush = time.monotonic()
            LOGGER.info("Committed Gold snapshot %s", result.snapshot_id)

        while True:
            try:
                messages = await subscription.fetch(batch=1, timeout=1)
            except NatsTimeoutError:
                messages = []
            for message in messages:
                try:
                    event = SilverEvent.from_dict(
                        json.loads(message.data.decode("utf-8"))
                    )
                    builder.save_pending(event)
                    await message.ack()
                    pending.append(
                        (
                            f"checkpoints/gold-builder/pending/{event.event_id}.json",
                            event,
                        )
                    )
                except Exception:
                    LOGGER.exception(
                        "Failed to persist Silver event; message will retry"
                    )
                    await message.nak()
            if pending and (
                len(pending) >= config.batch_size
                or time.monotonic() - last_flush >= config.flush_seconds
            ):
                await flush()
    finally:
        await nc.drain()
