"""Durable Silver-event consumer and workflow orchestrator for Enrichment.

Orchestrates the intake of Silver preprocessing events from NATS JetStream,
coordinates multimodal readiness pairing (Light Curves with Target Pixels),
dispatches admitted batches into the WorkerPool, and broadcasts real-time
telemetry to the control plane.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
import json
import logging
import time

from config import Config
from events import SilverEvent
from metrics import Metrics
from runtime.control import (
    EnrichmentControl,
    load_control,
    save_control,
    save_runtime_status,
    utc_now,
)
from runtime.pool import WorkerPool
from runtime.readiness import MultimodalReadiness, ReadinessSummary
from runtime.scheduler import PendingBatch, dispatchable_ready_batches
from storage.checkpoints import EnrichmentCheckpointStore
from storage.history import FactoryHistoryWriter
from storage.object_store import MinioObjectStore

LOGGER = logging.getLogger("aurora-enrichment")
DURABLE_SILVER_REFRESH_SECONDS = 10.0


async def run_worker(config: Config, metrics: Metrics) -> None:
    """Run the primary durable Enrichment worker service loop."""
    import nats
    from nats.errors import TimeoutError as NatsTimeoutError

    logging.basicConfig(level=getattr(logging, config.log_level.upper(), logging.INFO))

    # -----------------------------------------------------------------
    # 1. Initialize Storage & History Adapters
    # -----------------------------------------------------------------
    store = MinioObjectStore(
        config.minio_endpoint, config.minio_access_key, config.minio_secret_key
    )
    checkpoint_store = EnrichmentCheckpointStore(store, config.minio_bucket)
    history = FactoryHistoryWriter(config)
    history.ensure_schema()

    # -----------------------------------------------------------------
    # 2. Connect to NATS & Subscribe to JetStream Silver Events
    # -----------------------------------------------------------------
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
                    "Silver stream %s is not ready yet: %s; retrying in 5s",
                    config.stream,
                    exc,
                )
                await asyncio.sleep(5)

        # Ensure target GOLD stream exists for downstream ML consumers
        try:
            await js.add_stream(
                name="AURORA_GOLD",
                subjects=["aurora.v1.gold.>"],
            )
        except Exception:
            pass

        # -----------------------------------------------------------------
        # 3. Recover Pending Work & Seed Lineage on Startup
        # -----------------------------------------------------------------
        readiness = MultimodalReadiness(store, config.minio_bucket)

        # Recover work that was interrupted before completion
        pending = checkpoint_store.pending_unextracted_events(config.minio_bucket)

        # Recover historical Silver artifacts from durable lineage commits
        recovered = checkpoint_store.recover_pending_from_lineage(config.minio_bucket)
        pending.extend(recovered)

        # Modality separation:
        # TPF (Target Pixel Files) are durable, reusable spatial contexts for an entire sector.
        # LC (Light Curves) are consumed when an immutable Gold batch commits.
        lc_pending: PendingBatch = []
        for key, event in pending:
            if event.product_kind == "LIGHT_CURVE":
                lc_pending.append((key, event))
                continue
            readiness.persist_context(event)
            if key.startswith("checkpoints/enrichment/pending/"):
                store.delete(config.minio_bucket, key)
        pending = lc_pending

        # Initialize tracking timestamps
        last_received_at: float | None = time.monotonic() if pending else None
        first_silver_at = utc_now() if pending else ""
        last_silver_at = first_silver_at

        # Read the current committed candidate snapshot pointer if present
        current_snapshot = (
            store.get_json(config.minio_bucket, "gold/current/CANDIDATE.json") or {}
        )
        last_snapshot_id = str(current_snapshot.get("snapshot_id") or "")
        last_status_key = ""
        last_status_at = 0.0
        last_readiness_scan_at = 0.0
        last_lineage_scan_at = time.monotonic()
        observed_history_runs: set[str] = set()

        readiness_summary = ReadinessSummary(
            state="IDLE",
            waiting_lightcurves=0,
            ready_lightcurves=0,
            missing_tpf=0,
            catalog_ready=False,
            tic_catalog_ready=False,
            toi_catalog_ready=False,
            tpf_contexts=0,
            contracted_lightcurves=0,
            uncontracted_lightcurves=0,
        )

        # -----------------------------------------------------------------
        # 4. Helper Callbacks for State & Status Reporting
        # -----------------------------------------------------------------
        async def control_state() -> EnrichmentControl:
            """Fetch current operator control from MinIO."""
            return await asyncio.to_thread(load_control, store, config.minio_bucket)

        def pending_by_kind() -> dict[str, int]:
            """Count pending input items by product kind."""
            counts = {"LIGHT_CURVE": 0, "TARGET_PIXEL": 0}
            for _, event in pending:
                counts[event.product_kind] = counts.get(event.product_kind, 0) + 1
            return counts

        def observed_runtime_state(control: EnrichmentControl) -> str:
            """Synthesize an aggregate runtime state for dashboard display."""
            if control.mode == "PAUSED":
                return "DRAINING" if pool.active_builds else "FROZEN"
            if pool.active_builds or pool.queued_builds:
                return "RUNNING"
            if pending:
                return readiness_summary.state
            return "IDLE"

        async def report_status(control: EnrichmentControl, state: str) -> None:
            """Persist runtime status to MinIO and broadcast live updates via NATS."""
            nonlocal last_status_at, last_status_key
            if state in {"RUNNING", "READY"}:
                if pool.catalog_sync["state"] == "SYNCING":
                    state = "CATALOG_SYNCING"
                elif pool.catalog_sync["state"] == "RETRYING":
                    state = "WAITING_FOR_CATALOG_SYNC"

            next_flush_at = ""
            if (
                control.mode in {"STREAM", "BATCH"}
                and pending
                and 0 < readiness_summary.ready_lightcurves < control.max_batch_records
                and last_received_at is not None
            ):
                remaining = max(
                    0.0,
                    control.idle_flush_seconds - (time.monotonic() - last_received_at),
                )
                next_flush_at = (
                    datetime.now(timezone.utc) + timedelta(seconds=remaining)
                ).isoformat()

            snapshot = {
                "state": state,
                "mode": control.mode,
                "max_batch_records": control.max_batch_records,
                "idle_flush_seconds": control.idle_flush_seconds,
                "command_id": control.command_id,
                "pending_by_kind": pending_by_kind(),
                "readiness": {
                    "catalog_ready": readiness_summary.catalog_ready,
                    "tic_catalog_ready": readiness_summary.tic_catalog_ready,
                    "toi_catalog_ready": readiness_summary.toi_catalog_ready,
                    "waiting_lightcurves": readiness_summary.waiting_lightcurves,
                    "ready_lightcurves": readiness_summary.ready_lightcurves,
                    "missing_tpf": readiness_summary.missing_tpf,
                    "tpf_contexts": readiness_summary.tpf_contexts,
                    "contracted_lightcurves": readiness_summary.contracted_lightcurves,
                    "uncontracted_lightcurves": readiness_summary.uncontracted_lightcurves,
                },
                "active_builds": pool.active_builds,
                "workers": pool.worker_snapshots(),
                "first_silver_at": first_silver_at,
                "last_silver_at": last_silver_at,
                "next_flush_at": next_flush_at,
                "last_snapshot_id": pool.last_snapshot_id or last_snapshot_id,
                "last_error": pool.last_error,
                "catalog_sync": pool.catalog_sync,
            }
            serialized = json.dumps(snapshot, sort_keys=True)
            now = time.monotonic()

            # Throttle writes if status payload has not changed within 5 seconds
            if serialized == last_status_key and now - last_status_at < 5:
                return

            # Persist durable status JSON to MinIO
            await asyncio.to_thread(
                save_runtime_status,
                store,
                config.minio_bucket,
                state=state,
                control=control,
                pending_by_kind=snapshot["pending_by_kind"],
                active_builds=pool.active_builds,
                workers=snapshot["workers"],
                readiness=snapshot["readiness"],
                catalog_sync=snapshot["catalog_sync"],
                first_silver_at=first_silver_at,
                last_silver_at=last_silver_at,
                next_flush_at=next_flush_at,
                last_snapshot_id=snapshot["last_snapshot_id"],
                last_error=snapshot["last_error"],
            )
            last_status_key = serialized
            last_status_at = now

            # Broadcast live update event to UI
            await pool.publish_live(
                {
                    "event_type": "gold.runtime.updated",
                    "command_id": control.command_id,
                    "runtime": {
                        **snapshot,
                        "pending_total": sum(snapshot["pending_by_kind"].values()),
                        "updated_at": utc_now(),
                    },
                }
            )

            # Record durable run state in ClickHouse history
            history_state = f"{control.command_id}:{state}"
            should_record_history = (
                control.mode != "PAUSED" or control.command_id in observed_history_runs
            )
            if (
                control.command_id
                and should_record_history
                and history_state != pool.last_history_state
            ):
                await asyncio.to_thread(
                    history.record_run_state,
                    control,
                    state,
                    pending_inputs=sum(snapshot["pending_by_kind"].values()),
                    active_builds=pool.active_builds,
                    last_snapshot_id=snapshot["last_snapshot_id"],
                    last_error=snapshot["last_error"],
                )
                pool.last_history_state = history_state
                observed_history_runs.add(control.command_id)

        # -----------------------------------------------------------------
        # 5. Initialize Worker Concurrency Pool
        # -----------------------------------------------------------------
        pool = WorkerPool(
            config=config,
            metrics=metrics,
            store=store,
            history=history,
            nc=nc,
            js=js,
            control_getter=control_state,
            report_status_cb=report_status,
            observed_runtime_state_cb=observed_runtime_state,
            initial_snapshot_id=last_snapshot_id,
        )
        await pool.start()

        def merge_recovered_silver(
            recovered_events: PendingBatch,
        ) -> PendingBatch:
            """Deduplicate and register recovered Silver events from lineage."""
            existing_revisions = {event.revision_id for _, event in pending}
            recovered_lightcurves: PendingBatch = []
            for key, event in recovered_events:
                if event.product_kind == "LIGHT_CURVE":
                    if event.revision_id not in existing_revisions:
                        recovered_lightcurves.append((key, event))
                        existing_revisions.add(event.revision_id)
                    continue
                readiness.persist_context(event)
                if key.startswith("checkpoints/enrichment/pending/"):
                    store.delete(config.minio_bucket, key)
            return recovered_lightcurves

        def consume_ready(batch: PendingBatch) -> None:
            """Remove consumed LC queue items while preserving reusable TPF context."""
            consumed = {
                event.event_id
                for key, event in batch
                if key.startswith("checkpoints/enrichment/pending/")
                and event.product_kind == "LIGHT_CURVE"
            }
            if consumed:
                pending[:] = [
                    item for item in pending if item[1].event_id not in consumed
                ]

        LOGGER.info(
            "Enrichment worker ready: stream=%s durable=%s pending=%d lineage_backfill=%d workers=%d",
            config.stream,
            config.durable,
            len(pending),
            len(recovered),
            config.worker_concurrency,
        )

        # -----------------------------------------------------------------
        # 6. Main Orchestration Loop
        # -----------------------------------------------------------------
        try:
            while True:
                control = await control_state()
                await pool.update_idle_workers(control)

                # --- CASE A: Worker is PAUSED (Operator Freeze) ---
                if control.mode == "PAUSED":
                    now = time.monotonic()
                    # Periodically inspect lineage while paused to discover newly committed upstream data
                    if now - last_lineage_scan_at >= DURABLE_SILVER_REFRESH_SECONDS:
                        recovered = await asyncio.to_thread(
                            checkpoint_store.recover_pending_from_lineage,
                            config.minio_bucket,
                        )
                        recovered_lightcurves = await asyncio.to_thread(
                            merge_recovered_silver, recovered
                        )
                        if recovered_lightcurves:
                            pending.extend(recovered_lightcurves)
                        if recovered:
                            LOGGER.info(
                                "Observed %d new durable Silver lineage records while paused (%d LC queued)",
                                len(recovered),
                                len(recovered_lightcurves),
                            )
                        last_lineage_scan_at = now

                    # Scan multimodal readiness periodically
                    if now - last_readiness_scan_at >= 5:
                        _, readiness_summary = await asyncio.to_thread(
                            readiness.collect_ready, pending, control.max_batch_records
                        )
                        last_readiness_scan_at = now

                    await report_status(control, observed_runtime_state(control))
                    await asyncio.sleep(1)
                    continue

                # --- CASE B: Active Intake (STREAM or BATCH mode) ---
                if pending and last_received_at is None:
                    last_received_at = time.monotonic()
                    first_silver_at = utc_now()
                    last_silver_at = first_silver_at

                # Pull new Silver events from NATS JetStream pull consumer
                try:
                    messages = await subscription.fetch(batch=100, timeout=1)
                except (NatsTimeoutError, asyncio.TimeoutError):
                    messages = []

                pending_revisions = {event.revision_id for _, event in pending}
                for message in messages:
                    try:
                        event = SilverEvent.from_dict(
                            json.loads(message.data.decode("utf-8"))
                        )
                        # Light Curve: persist to pending checkpoint queue
                        if event.product_kind == "LIGHT_CURVE":
                            if event.revision_id not in pending_revisions:
                                checkpoint_store.save_pending(event)
                        else:
                            # Target Pixel: persist reusable spatial context
                            readiness.persist_context(event)

                        await message.ack()
                        if not pending:
                            first_silver_at = utc_now()

                        if event.product_kind == "LIGHT_CURVE":
                            if event.revision_id not in pending_revisions:
                                pending.append(
                                    (
                                        f"checkpoints/enrichment/pending/{event.event_id}.json",
                                        event,
                                    )
                                )
                                pending_revisions.add(event.revision_id)

                        last_received_at = time.monotonic()
                        last_silver_at = utc_now()
                    except Exception:
                        LOGGER.exception(
                            "Failed to persist Silver event; message will retry"
                        )
                        await message.nak()

                if messages:
                    await nc.flush()

                # Evaluate multimodal readiness: LC waiting for TPF pairs
                ready_batches, readiness_summary = await asyncio.to_thread(
                    readiness.collect_ready, pending, control.max_batch_records
                )

                # --- BATCH Mode Dispatching ---
                if control.mode == "BATCH":
                    dispatchable = dispatchable_ready_batches(
                        ready_batches,
                        max_batch_records=control.max_batch_records,
                        last_received_at=last_received_at,
                        idle_flush_seconds=control.idle_flush_seconds,
                    )
                    if dispatchable:
                        for batch in dispatchable:
                            consume_ready(batch)
                            await pool.enqueue(batch)
                        if not pending:
                            last_received_at = None
                        await report_status(control, "RUNNING")
                    elif (
                        not pending
                        and pool.active_builds == 0
                        and pool.queued_builds == 0
                    ):
                        # When all work in BATCH mode completes, transition back to PAUSED
                        frozen_control = EnrichmentControl(
                            mode="PAUSED",
                            max_batch_records=control.max_batch_records,
                            idle_flush_seconds=control.idle_flush_seconds,
                            command_id=control.command_id,
                            updated_at=utc_now(),
                            requested_by="enrichment",
                        )
                        await asyncio.to_thread(
                            save_control,
                            store,
                            config.minio_bucket,
                            frozen_control,
                        )
                        await report_status(frozen_control, "FROZEN")
                    else:
                        await report_status(control, observed_runtime_state(control))
                    continue

                # --- STREAM Mode Dispatching ---
                # Full batches dispatch immediately; partial batches accumulate
                partial_ready_batches: list[PendingBatch] = []
                for batch in ready_batches:
                    candidate_count = sum(
                        event.product_kind == "LIGHT_CURVE" for _, event in batch
                    )
                    if candidate_count < control.max_batch_records:
                        partial_ready_batches.append(batch)
                        continue
                    consume_ready(batch)
                    await pool.enqueue(batch)
                    last_received_at = None if not pending else last_received_at

                # Idle flush: if upstream has been quiet longer than idle_flush_seconds, flush partial batches
                if (
                    partial_ready_batches
                    and last_received_at is not None
                    and time.monotonic() - last_received_at
                    >= control.idle_flush_seconds
                ):
                    for batch in partial_ready_batches:
                        if not any(
                            event.product_kind == "LIGHT_CURVE" for _, event in batch
                        ):
                            continue
                        consume_ready(batch)
                        await pool.enqueue(batch)
                    last_received_at = None

                await report_status(control, observed_runtime_state(control))

        finally:
            # Cleanly terminate worker pool and cancel tasks
            await pool.shutdown()
    finally:
        # Drain remaining NATS traffic
        await nc.drain()
