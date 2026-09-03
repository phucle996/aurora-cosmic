"""Durable Silver-event consumer for Gold Builder."""

from __future__ import annotations

import asyncio
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timedelta, timezone
import json
import logging
import time

from ..config import Config
from ..domain.events import SilverEvent
from ..infrastructure.clickhouse_projection import GoldClickHouseProjector
from ..infrastructure.history import FactoryHistoryWriter
from ..infrastructure.object_store import MinioObjectStore
from ..observer import Metrics
from .control import (
    GoldControl,
    load_control,
    save_control,
    save_runtime_status,
    utc_now,
)
from .catalogs import CatalogBundle, CatalogSyncError, sync_catalogs_for_tics
from .materializer import GoldBuilder
from .readiness import MultimodalReadiness, ReadinessSummary

LOGGER = logging.getLogger("aurora-gold-builder")
PendingBatch = list[tuple[str, SilverEvent]]
DURABLE_SILVER_REFRESH_SECONDS = 10.0


def dispatchable_ready_batches(
    ready_batches: list[PendingBatch],
    *,
    max_batch_records: int,
    last_received_at: float | None,
    idle_flush_seconds: float,
    now: float | None = None,
) -> list[PendingBatch]:
    """Close full batches immediately and partial batches only after quiescence.

    ``max_batch_records`` is a target count, not merely a queue upper bound.
    Silver LC/TPF pairs often become ready in small waves; admitting every wave
    creates many tiny immutable snapshots and defeats backlog batching.
    """
    full: list[PendingBatch] = []
    partial: list[PendingBatch] = []
    for batch in ready_batches:
        target_count = sum(
            event.product_kind == "LIGHT_CURVE" for _, event in batch
        )
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
    return [*full, *(partial if source_quiet else [])]


def _materialize_candidate(
    config: Config, events: list[SilverEvent], catalogs: CatalogBundle
):
    """Commit canonical Gold, then index it before acknowledging Silver input."""
    store = MinioObjectStore(
        config.minio_endpoint, config.minio_access_key, config.minio_secret_key
    )
    result = GoldBuilder(
        store=store,
        default_bucket=config.minio_bucket,
        scratch_dir=config.scratch_dir,
    ).build_candidate(events, set_current=True, catalogs=catalogs)
    indexed_rows = GoldClickHouseProjector(config, store).project(result)
    return result, indexed_rows


async def run_worker(config: Config, metrics: Metrics) -> None:
    import nats
    from nats.errors import TimeoutError as NatsTimeoutError

    logging.basicConfig(level=getattr(logging, config.log_level.upper(), logging.INFO))

    def new_builder() -> GoldBuilder:
        return GoldBuilder(
            store=MinioObjectStore(
                config.minio_endpoint, config.minio_access_key, config.minio_secret_key
            ),
            default_bucket=config.minio_bucket,
            scratch_dir=config.scratch_dir,
        )

    checkpoint_builder = new_builder()
    history = FactoryHistoryWriter(config)
    history.ensure_schema()
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
        readiness = MultimodalReadiness(checkpoint_builder.store, config.minio_bucket)
        pending = checkpoint_builder.pending_unextracted_events(config.minio_bucket)
        recovered = checkpoint_builder.recover_pending_from_lineage(config.minio_bucket)
        pending.extend(recovered)
        # Migrate pre-readiness queues. TPF is durable reusable context;
        # only LC entries are consumed when a research-ready Gold batch commits.
        lc_pending: PendingBatch = []
        for key, event in pending:
            if event.product_kind == "LIGHT_CURVE":
                lc_pending.append((key, event))
                continue
            readiness.persist_context(event)
            if key.startswith("checkpoints/gold-builder/pending/"):
                checkpoint_builder.store.delete(config.minio_bucket, key)
        pending = lc_pending
        last_received_at: float | None = time.monotonic() if pending else None
        first_silver_at = utc_now() if pending else ""
        last_silver_at = first_silver_at
        current_snapshot = (
            checkpoint_builder.store.get_json(
                config.minio_bucket, "gold/current/CANDIDATE.json"
            )
            or {}
        )
        # The current pointer is written only after an immutable snapshot has
        # committed. Recover it on process restart so runtime telemetry never
        # hides real Gold output merely because the worker was restarted.
        last_snapshot_id = str(current_snapshot.get("snapshot_id") or "")
        last_error = ""
        active_builds = 0
        queued_builds = 0
        last_status_key = ""
        last_status_at = 0.0
        last_readiness_scan_at = 0.0
        last_lineage_scan_at = time.monotonic()
        last_history_state = ""
        observed_history_runs: set[str] = set()
        catalog_sync = {
            "mode": "ON_DEMAND",
            "state": "IDLE",
            "target_count": 0,
            "tic_records": 0,
            "toi_records": 0,
            "snapshot_ids": {},
            "cache_hit": False,
            "error": "",
        }
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
        batch_queue: asyncio.Queue[PendingBatch] = asyncio.Queue(
            maxsize=config.worker_concurrency * 2
        )
        build_executor = ProcessPoolExecutor(max_workers=config.worker_concurrency)
        publish_lock = asyncio.Lock()
        telemetry_lock = asyncio.Lock()
        observer_tickets: set[str] = set()
        worker_states: dict[int, dict[str, object]] = {}

        def worker_snapshots() -> list[dict[str, object]]:
            return [dict(worker_states[key]) for key in sorted(worker_states)]

        async def publish_live(
            event: dict[str, object], tickets: set[str] | None = None
        ) -> None:
            targets = set(observer_tickets if tickets is None else tickets)
            if not targets:
                return
            async with telemetry_lock:
                for ticket_id in targets:
                    payload = json.dumps(
                        {
                            "schema_version": 1,
                            "ticket_id": ticket_id,
                            "occurred_at": utc_now(),
                            **event,
                        },
                        sort_keys=True,
                    ).encode()
                    await nc.publish("aurora.live.gold.worker", payload)
                await nc.flush()

        async def set_worker_state(
            worker_id: int,
            *,
            lifecycle: str = "ALIVE",
            action: str,
            control: GoldControl | None = None,
            batch_ref: str = "",
            input_count: int = 0,
            snapshot_id: str = "",
            detail: str = "",
        ) -> None:
            previous = worker_states.get(worker_id)
            state: dict[str, object] = {
                "worker_id": f"GOLD-{worker_id:02d}",
                "lifecycle": lifecycle,
                "action": action,
                "command_id": control.command_id if control else "",
                "batch_ref": batch_ref,
                "input_count": input_count,
                "snapshot_id": snapshot_id,
                "detail": detail,
            }
            comparable = {
                key: value for key, value in state.items() if key != "updated_at"
            }
            previous_comparable = {
                key: value
                for key, value in (previous or {}).items()
                if key != "updated_at"
            }
            if comparable == previous_comparable:
                return
            state["updated_at"] = utc_now()
            worker_states[worker_id] = state
            await publish_live(
                {
                    "event_type": "gold.worker.lifecycle",
                    "command_id": state["command_id"],
                    "worker": state,
                }
            )

        async def observe_register(message) -> None:
            try:
                ticket_id = str(
                    json.loads(message.data.decode("utf-8")).get("ticket_id", "")
                ).strip()
            except (UnicodeDecodeError, json.JSONDecodeError, AttributeError):
                return
            if not ticket_id or len(ticket_id) > 128:
                return
            observer_tickets.add(ticket_id)
            for worker in worker_snapshots():
                await publish_live(
                    {
                        "event_type": "gold.worker.lifecycle",
                        "command_id": worker.get("command_id", ""),
                        "worker": worker,
                    },
                    {ticket_id},
                )

        async def observe_unregister(message) -> None:
            try:
                ticket_id = str(
                    json.loads(message.data.decode("utf-8")).get("ticket_id", "")
                ).strip()
            except (UnicodeDecodeError, json.JSONDecodeError, AttributeError):
                return
            observer_tickets.discard(ticket_id)

        await nc.subscribe("aurora.observe.gold.register", cb=observe_register)
        await nc.subscribe("aurora.observe.gold.unregister", cb=observe_unregister)

        def pending_by_kind() -> dict[str, int]:
            counts = {"LIGHT_CURVE": 0, "TARGET_PIXEL": 0}
            for _, event in pending:
                counts[event.product_kind] = counts.get(event.product_kind, 0) + 1
            return counts

        def merge_recovered_silver(
            recovered_events: PendingBatch,
        ) -> PendingBatch:
            """Convert durable lineage into LC work and reusable TPF context."""
            existing_revisions = {event.revision_id for _, event in pending}
            recovered_lightcurves: PendingBatch = []
            for key, event in recovered_events:
                if event.product_kind == "LIGHT_CURVE":
                    if event.revision_id not in existing_revisions:
                        recovered_lightcurves.append((key, event))
                        existing_revisions.add(event.revision_id)
                    continue
                readiness.persist_context(event)
                if key.startswith("checkpoints/gold-builder/pending/"):
                    checkpoint_builder.store.delete(config.minio_bucket, key)
            return recovered_lightcurves

        async def control_state() -> GoldControl:
            return await asyncio.to_thread(
                load_control, checkpoint_builder.store, config.minio_bucket
            )

        async def report_status(control: GoldControl, state: str) -> None:
            nonlocal last_status_at, last_status_key, last_history_state
            if state in {"RUNNING", "READY"}:
                if catalog_sync["state"] == "SYNCING":
                    state = "CATALOG_SYNCING"
                elif catalog_sync["state"] == "RETRYING":
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
                "active_builds": active_builds,
                "workers": worker_snapshots(),
                "first_silver_at": first_silver_at,
                "last_silver_at": last_silver_at,
                "next_flush_at": next_flush_at,
                "last_snapshot_id": last_snapshot_id,
                "last_error": last_error,
                "catalog_sync": catalog_sync,
            }
            serialized = json.dumps(snapshot, sort_keys=True)
            now = time.monotonic()
            if serialized == last_status_key and now - last_status_at < 5:
                return
            await asyncio.to_thread(
                save_runtime_status,
                checkpoint_builder.store,
                config.minio_bucket,
                state=state,
                control=control,
                pending_by_kind=snapshot["pending_by_kind"],
                active_builds=active_builds,
                workers=snapshot["workers"],
                readiness=snapshot["readiness"],
                catalog_sync=snapshot["catalog_sync"],
                first_silver_at=first_silver_at,
                last_silver_at=last_silver_at,
                next_flush_at=next_flush_at,
                last_snapshot_id=last_snapshot_id,
                last_error=last_error,
            )
            last_status_key = serialized
            last_status_at = now
            await publish_live(
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
            history_state = f"{control.command_id}:{state}"
            should_record_history = (
                control.mode != "PAUSED" or control.command_id in observed_history_runs
            )
            if (
                control.command_id
                and should_record_history
                and history_state != last_history_state
            ):
                await asyncio.to_thread(
                    history.record_run_state,
                    control,
                    state,
                    pending_inputs=sum(snapshot["pending_by_kind"].values()),
                    active_builds=active_builds,
                    last_snapshot_id=last_snapshot_id,
                    last_error=last_error,
                )
                last_history_state = history_state
                observed_history_runs.add(control.command_id)

        def observed_runtime_state(control: GoldControl) -> str:
            """Return one truthful aggregate state for the control plane.

            A few unmatched light curves must not overwrite the fact that
            another batch is currently materializing. Readiness exposes both
            facts; the primary state describes the work happening now.
            """
            if control.mode == "PAUSED":
                return "DRAINING" if active_builds else "FROZEN"
            if active_builds or queued_builds:
                return "RUNNING"
            if pending:
                return readiness_summary.state
            return "IDLE"

        async def build_batch(worker_id: int) -> None:
            await set_worker_state(
                worker_id,
                lifecycle="SPAWNED",
                action="WAITING_FOR_BATCH",
                detail="Worker slot spawned and waiting for an eligible LC/TPF batch",
            )
            try:
                while True:
                    batch = await batch_queue.get()
                    batch_ref = batch[0][1].event_id if batch else ""
                    await set_worker_state(
                        worker_id,
                        action="DEQUEUED_BATCH",
                        batch_ref=batch_ref,
                        input_count=len(batch),
                        detail="Claimed a durable Silver batch from the runtime queue",
                    )
                    await run_claimed_batch(worker_id, batch, batch_ref)
            finally:
                await set_worker_state(
                    worker_id,
                    lifecycle="KILLED",
                    action="CANCELLED",
                    detail="Worker task exited and no longer accepts batches",
                )

        async def run_claimed_batch(
            worker_id: int, batch: PendingBatch, batch_ref: str
        ) -> None:
            nonlocal \
                active_builds, \
                queued_builds, \
                last_snapshot_id, \
                last_error, \
                last_history_state, \
                catalog_sync
            batch_control: GoldControl | None = None
            attempt_started_at: float | None = None
            attempt_finished_at: float | None = None
            attempt_status = "failed"
            successful_inputs = 0
            successful_rows = 0
            try:
                # A Stop command never kills a materialization half-way.
                # Batches already queued wait here until an operator resumes.
                while (await control_state()).mode == "PAUSED":
                    await set_worker_state(
                        worker_id,
                        action="WAITING_FOR_RESUME",
                        batch_ref=batch_ref,
                        input_count=len(batch),
                        detail="Batch retained; operator control is paused",
                    )
                    await asyncio.sleep(1)
                active_builds += 1
                queued_builds = max(0, queued_builds - 1)
                metrics.set_queue_depth(batch_queue.qsize())
                metrics.build_started()
                attempt_started_at = time.monotonic()
                events = [event for _, event in batch]
                batch_control = await control_state()
                await set_worker_state(
                    worker_id,
                    action="SYNCING_CATALOGS",
                    control=batch_control,
                    batch_ref=batch_ref,
                    input_count=len(batch),
                    detail="Resolving immutable TIC and TOI evidence for this batch",
                )
                started_at = datetime.now(timezone.utc)
                tic_ids = sorted(
                    {
                        int(event.tic_id)
                        for event in events
                        if event.product_kind == "LIGHT_CURVE"
                        and event.tic_id is not None
                        and int(event.tic_id) > 0
                    }
                )
                if not tic_ids:
                    raise CatalogSyncError(
                        "Gold batch has no valid TIC IDs for catalog enrichment"
                    )
                catalog_sync = {
                    "mode": "ON_DEMAND",
                    "state": "SYNCING",
                    "target_count": len(tic_ids),
                    "tic_records": 0,
                    "toi_records": 0,
                    "snapshot_ids": {},
                    "cache_hit": False,
                    "error": "",
                }
                await report_status(batch_control, "CATALOG_SYNCING")
                catalog_result = await asyncio.to_thread(
                    sync_catalogs_for_tics,
                    checkpoint_builder.store,
                    config.minio_bucket,
                    tic_ids,
                )
                catalog_sync = {
                    "mode": "ON_DEMAND",
                    "state": "READY",
                    "target_count": catalog_result.target_count,
                    "tic_records": catalog_result.tic_records,
                    "toi_records": catalog_result.toi_records,
                    "snapshot_ids": catalog_result.catalogs.snapshot_ids,
                    "cache_hit": catalog_result.cache_hit,
                    "error": "",
                }
                await report_status(batch_control, "RUNNING")
                await set_worker_state(
                    worker_id,
                    action="MATERIALIZING_AND_INDEXING",
                    control=batch_control,
                    batch_ref=batch_ref,
                    input_count=len(batch),
                    detail="Writing Gold Parquet artifacts and projecting rows to ClickHouse",
                )
                (
                    result,
                    indexed_rows,
                ) = await asyncio.get_running_loop().run_in_executor(
                    build_executor,
                    _materialize_candidate,
                    config,
                    events,
                    catalog_result.catalogs,
                )
                completed_at = datetime.now(timezone.utc)
                await set_worker_state(
                    worker_id,
                    action="COMMITTING_SNAPSHOT",
                    control=batch_control,
                    batch_ref=batch_ref,
                    input_count=len(batch),
                    snapshot_id=result.snapshot_id,
                    detail="Recording durable run history and publishing the committed snapshot",
                )
                await asyncio.to_thread(
                    history.record_batch,
                    batch_control,
                    result,
                    input_records=sum(
                        event.product_kind == "LIGHT_CURVE" for event in events
                    ),
                    indexed_rows=indexed_rows,
                    started_at=started_at,
                    completed_at=completed_at,
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
                        "dataset_row_counts": result.dataset_row_counts,
                        "clickhouse_indexed_rows": indexed_rows,
                    },
                    sort_keys=True,
                ).encode()
                async with publish_lock:
                    await js.publish("aurora.v1.gold.candidate.committed", payload)
                    await nc.flush()
                await asyncio.to_thread(new_builder().clear_pending, batch)
                last_snapshot_id = result.snapshot_id
                last_error = ""
                attempt_status = "success"
                successful_inputs = sum(
                    event.product_kind == "LIGHT_CURVE" for event in events
                )
                successful_rows = indexed_rows
                attempt_finished_at = time.monotonic()
                LOGGER.info(
                    "Committed Gold snapshot %s (worker=%d inputs=%d)",
                    result.snapshot_id,
                    worker_id,
                    sum(event.product_kind == "LIGHT_CURVE" for _, event in batch),
                )
                await set_worker_state(
                    worker_id,
                    action="SNAPSHOT_COMMITTED",
                    control=batch_control,
                    batch_ref=batch_ref,
                    input_count=len(batch),
                    snapshot_id=result.snapshot_id,
                    detail=f"Committed {indexed_rows} indexed Gold rows",
                )
            except CatalogSyncError as exc:
                attempt_status = "deferred"
                attempt_finished_at = time.monotonic()
                last_error = "Gold is waiting for verified TIC/TOI catalog evidence"
                catalog_sync = {
                    **catalog_sync,
                    "state": "RETRYING",
                    "error": str(exc),
                }
                await set_worker_state(
                    worker_id,
                    action="RETRYING_CATALOG_SYNC",
                    control=batch_control,
                    batch_ref=batch_ref,
                    input_count=len(batch),
                    detail=str(exc),
                )
                if batch_control is not None and batch_control.command_id:
                    await asyncio.to_thread(
                        history.record_run_state,
                        batch_control,
                        "WAITING_FOR_CATALOG_SYNC",
                        pending_inputs=len(batch),
                        active_builds=active_builds,
                        last_snapshot_id=last_snapshot_id,
                        last_error=last_error,
                    )
                    last_history_state = (
                        f"{batch_control.command_id}:WAITING_FOR_CATALOG_SYNC"
                    )
                    await report_status(batch_control, "WAITING_FOR_CATALOG_SYNC")
                LOGGER.warning(
                    "Catalog evidence is not ready; retaining Gold batch for retry "
                    "(worker=%d targets=%d): %s",
                    worker_id,
                    len(batch),
                    exc,
                )
                await asyncio.sleep(10)
                await enqueue(batch)
            except Exception:
                attempt_status = "failed"
                attempt_finished_at = time.monotonic()
                last_error = "Gold materialization failed; checkpoints retained"
                await set_worker_state(
                    worker_id,
                    action="FAILED_RETRY_SCHEDULED",
                    control=batch_control,
                    batch_ref=batch_ref,
                    input_count=len(batch),
                    detail=last_error,
                )
                if batch_control is not None and batch_control.command_id:
                    await asyncio.to_thread(
                        history.record_run_state,
                        batch_control,
                        "FAILED",
                        pending_inputs=len(batch),
                        active_builds=active_builds,
                        last_snapshot_id=last_snapshot_id,
                        last_error=last_error,
                    )
                    last_history_state = f"{batch_control.command_id}:FAILED"
                LOGGER.exception(
                    "Gold batch failed; durable checkpoints are retained for retry (worker=%d inputs=%d)",
                    worker_id,
                    len(batch),
                )
                await asyncio.sleep(5)
                await enqueue(batch)
            finally:
                if attempt_started_at is not None:
                    metrics.build_finished(
                        attempt_status,
                        (attempt_finished_at or time.monotonic()) - attempt_started_at,
                        input_records=successful_inputs,
                        output_rows=successful_rows,
                    )
                active_builds = max(0, active_builds - 1)
                batch_queue.task_done()
                # A commit or retry changes the externally observed state
                # immediately. Waiting for the next NATS poll left stale
                # active-build counts and stale error messages in the UI.
                try:
                    current_control = await control_state()
                    await set_worker_state(
                        worker_id,
                        action=(
                            "FROZEN"
                            if current_control.mode == "PAUSED"
                            else "WAITING_FOR_BATCH"
                        ),
                        control=current_control,
                        detail=(
                            "Worker slot retained but intake is frozen"
                            if current_control.mode == "PAUSED"
                            else "Waiting for an eligible LC/TPF batch"
                        ),
                    )
                    await report_status(
                        current_control, observed_runtime_state(current_control)
                    )
                except Exception:
                    LOGGER.exception(
                        "Unable to publish Gold runtime status after batch completion"
                    )

        workers = [
            asyncio.create_task(build_batch(worker_id))
            for worker_id in range(1, config.worker_concurrency + 1)
        ]

        async def enqueue(batch: PendingBatch) -> None:
            nonlocal queued_builds
            if batch:
                await batch_queue.put(batch)
                queued_builds += 1
                metrics.set_queue_depth(batch_queue.qsize())

        def consume_ready(batch: PendingBatch) -> None:
            """Remove only LC queue entries; modality context remains reusable."""
            consumed = {
                event.event_id
                for key, event in batch
                if key.startswith("checkpoints/gold-builder/pending/")
                and event.product_kind == "LIGHT_CURVE"
            }
            if consumed:
                pending[:] = [
                    item for item in pending if item[1].event_id not in consumed
                ]

        LOGGER.info(
            "Gold Builder ready: stream=%s durable=%s pending=%d lineage_backfill=%d workers=%d",
            config.stream,
            config.durable,
            len(pending),
            len(recovered),
            config.worker_concurrency,
        )

        try:
            while True:
                control = await control_state()
                idle_action = (
                    "FROZEN" if control.mode == "PAUSED" else "WAITING_FOR_BATCH"
                )
                for worker_id, worker_state in list(worker_states.items()):
                    if worker_state.get("lifecycle") == "KILLED" or worker_state.get(
                        "action"
                    ) not in {"WAITING_FOR_BATCH", "FROZEN"}:
                        continue
                    await set_worker_state(
                        worker_id,
                        action=idle_action,
                        control=control,
                        detail=(
                            "Worker slot retained but intake is frozen"
                            if control.mode == "PAUSED"
                            else "Waiting for an eligible LC/TPF batch"
                        ),
                    )
                if control.mode == "PAUSED":
                    # A human freeze stops intake immediately.  The process
                    # currently executing in the pool is allowed to commit,
                    # then the runtime becomes FROZEN; queued work remains
                    # durably checkpointed for an explicit future resume.
                    # A freeze stops materialization, not observation. Refresh
                    # readiness periodically from durable Silver/TPF state so
                    # the dashboard explains exactly what would block the next
                    # human-triggered run without issuing a remote scan each
                    # second.
                    now = time.monotonic()
                    if now - last_lineage_scan_at >= DURABLE_SILVER_REFRESH_SECONDS:
                        recovered = await asyncio.to_thread(
                            checkpoint_builder.recover_pending_from_lineage,
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
                    if now - last_readiness_scan_at >= 5:
                        _, readiness_summary = await asyncio.to_thread(
                            readiness.collect_ready, pending, control.max_batch_records
                        )
                        last_readiness_scan_at = now
                    await report_status(control, observed_runtime_state(control))
                    await asyncio.sleep(1)
                    continue

                if pending and last_received_at is None:
                    last_received_at = time.monotonic()
                    first_silver_at = utc_now()
                    last_silver_at = first_silver_at

                try:
                    messages = await subscription.fetch(batch=100, timeout=1)
                except (NatsTimeoutError, asyncio.TimeoutError):
                    # A pull consumer timing out is a normal idle condition,
                    # not a worker failure.  The nats-py client may surface
                    # the timeout as either its own error or asyncio's
                    # TimeoutError depending on the request path/version.
                    messages = []
                pending_revisions = {event.revision_id for _, event in pending}
                for message in messages:
                    try:
                        event = SilverEvent.from_dict(
                            json.loads(message.data.decode("utf-8"))
                        )
                        if event.product_kind == "LIGHT_CURVE":
                            if event.revision_id not in pending_revisions:
                                checkpoint_builder.save_pending(event)
                        else:
                            readiness.persist_context(event)
                        await message.ack()
                        if not pending:
                            first_silver_at = utc_now()
                        if event.product_kind == "LIGHT_CURVE":
                            if event.revision_id not in pending_revisions:
                                pending.append(
                                    (
                                        f"checkpoints/gold-builder/pending/{event.event_id}.json",
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

                ready_batches, readiness_summary = await asyncio.to_thread(
                    readiness.collect_ready, pending, control.max_batch_records
                )

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
                            await enqueue(batch)
                        if not pending:
                            last_received_at = None
                        # Batch mode used to continue immediately after queuing
                        # work.  That left the persisted runtime status at the
                        # previous FROZEN/IDLE value for the entire batch run,
                        # even though the process pool was materializing Gold.
                        # Persist the transition now so the control plane and
                        # run-history share the same durable RUNNING state.
                        await report_status(control, "RUNNING")
                    elif not pending and active_builds == 0 and queued_builds == 0:
                        frozen_control = GoldControl(
                            mode="PAUSED",
                            max_batch_records=control.max_batch_records,
                            idle_flush_seconds=control.idle_flush_seconds,
                            command_id=control.command_id,
                            updated_at=utc_now(),
                            requested_by="gold-builder",
                        )
                        await asyncio.to_thread(
                            save_control,
                            checkpoint_builder.store,
                            config.minio_bucket,
                            frozen_control,
                        )
                        await report_status(frozen_control, "FROZEN")
                    else:
                        await report_status(control, observed_runtime_state(control))
                    continue

                partial_ready_batches: list[PendingBatch] = []
                for batch in ready_batches:
                    candidate_count = sum(
                        event.product_kind == "LIGHT_CURVE" for _, event in batch
                    )
                    if candidate_count < control.max_batch_records:
                        partial_ready_batches.append(batch)
                        continue
                    consume_ready(batch)
                    await enqueue(batch)
                    last_received_at = None if not pending else last_received_at

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
                        await enqueue(batch)
                    last_received_at = None

                await report_status(control, observed_runtime_state(control))
        finally:
            for worker in workers:
                worker.cancel()
            await asyncio.gather(*workers, return_exceptions=True)
            build_executor.shutdown(wait=False, cancel_futures=True)
    finally:
        await nc.drain()
