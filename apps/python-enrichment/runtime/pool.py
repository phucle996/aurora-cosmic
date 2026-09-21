"""Worker pool and batch processing execution across ProcessPoolExecutor.

Coordinates worker slots, manages the process pool executor for compute-heavy
tasks (feature extraction, Parquet serialization, ClickHouse indexing),
and reports live lifecycle telemetry to the operator dashboard via NATS.
"""

from __future__ import annotations

import asyncio
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timezone
import json
import logging
import time
from typing import Any, Awaitable, Callable

from config import Config
from events import SilverEvent
from metrics import Metrics
from pipeline.catalogs import CatalogBundle, CatalogSyncError, sync_catalogs_for_tics
from pipeline.materializer import (
    EnrichmentBuildResult,
    EnrichmentBuilder,
)
from runtime.control import EnrichmentControl, utc_now
from storage.clickhouse import EnrichmentClickHouseProjector
from storage.history import FactoryHistoryWriter
from storage.object_store import MinioObjectStore, ObjectStore

LOGGER = logging.getLogger("aurora-enrichment-pool")
PendingBatch = list[tuple[str, SilverEvent]]


# =====================================================================
# Top-level functions executed inside ProcessPoolExecutor
# (Must remain picklable top-level callables for Python multiprocessing)
# =====================================================================


def _build_candidate_parquet(
    config: Config, events: list[SilverEvent], catalogs: CatalogBundle
) -> EnrichmentBuildResult:
    """Build candidate snapshot and serialize Parquet artifacts to MinIO.

    Executed in a background process worker to prevent heavy NumPy/PyArrow
    computations from blocking the asyncio event loop.
    """
    store = MinioObjectStore(
        config.minio_endpoint, config.minio_access_key, config.minio_secret_key
    )
    return EnrichmentBuilder(
        store=store,
        default_bucket=config.minio_bucket,
        scratch_dir=config.scratch_dir,
    ).build_candidate(events, set_current=True, catalogs=catalogs)


def _project_candidate_clickhouse(config: Config, result: EnrichmentBuildResult) -> int:
    """Project materialized Gold/Enrichment rows into ClickHouse.

    Executed in a background process worker to isolate network I/O and bulk
    Arrow stream insertion into ClickHouse tables.
    """
    store = MinioObjectStore(
        config.minio_endpoint, config.minio_access_key, config.minio_secret_key
    )
    return EnrichmentClickHouseProjector(config, store).project(result)


# =====================================================================
# Worker Concurrency Pool
# =====================================================================


class WorkerPool:
    """Manages worker concurrency slots, ProcessPoolExecutor, and batch tasks."""

    def __init__(
        self,
        config: Config,
        metrics: Metrics,
        store: ObjectStore,
        history: FactoryHistoryWriter,
        nc: Any,
        js: Any,
        control_getter: Callable[[], Awaitable[EnrichmentControl]],
        report_status_cb: Callable[[EnrichmentControl, str], Awaitable[None]],
        observed_runtime_state_cb: Callable[[EnrichmentControl], str],
        initial_snapshot_id: str = "",
    ):
        self.config = config
        self.metrics = metrics
        self.store = store
        self.history = history
        self.nc = nc
        self.js = js
        self.control_getter = control_getter
        self.report_status_cb = report_status_cb
        self.observed_runtime_state_cb = observed_runtime_state_cb

        # Asynchronous runtime queue feeding worker slots
        self.batch_queue: asyncio.Queue[PendingBatch] = asyncio.Queue(
            maxsize=config.worker_concurrency * 2
        )
        self.build_executor = ProcessPoolExecutor(max_workers=config.worker_concurrency)

        # Telemetry & observation state
        self.publish_lock = asyncio.Lock()
        self.telemetry_lock = asyncio.Lock()
        self.observer_tickets: set[str] = set()
        self.worker_states: dict[int, dict[str, object]] = {}

        # Tracking metrics & status counters
        self.active_builds: int = 0
        self.queued_builds: int = 0
        self.last_snapshot_id: str = initial_snapshot_id
        self.last_error: str = ""
        self.last_history_state: str = ""
        self.catalog_sync: dict[str, Any] = {
            "mode": "ON_DEMAND",
            "state": "IDLE",
            "target_count": 0,
            "tic_records": 0,
            "toi_records": 0,
            "snapshot_ids": {},
            "cache_hit": False,
            "error": "",
        }
        self._workers: list[asyncio.Task] = []

    # -----------------------------------------------------------------
    # Telemetry and Observation Handlers
    # -----------------------------------------------------------------

    def worker_snapshots(self) -> list[dict[str, object]]:
        """Return a copy of the current state of all worker slots."""
        return [dict(self.worker_states[key]) for key in sorted(self.worker_states)]

    async def publish_live(
        self, event: dict[str, object], tickets: set[str] | None = None
    ) -> None:
        """Publish ephemeral live events to active observer tickets via NATS."""
        targets = set(self.observer_tickets if tickets is None else tickets)
        if not targets:
            return
        async with self.telemetry_lock:
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
                await self.nc.publish("aurora.live.gold.worker", payload)
            await self.nc.flush()

    async def set_worker_state(
        self,
        worker_id: int,
        *,
        lifecycle: str = "ALIVE",
        action: str,
        control: EnrichmentControl | None = None,
        batch_ref: str = "",
        input_count: int = 0,
        snapshot_id: str = "",
        detail: str = "",
        step_index: int = 0,
        step_name: str = "IDLE",
    ) -> None:
        """Update and broadcast worker state transitions if state meaningfully changed."""
        previous = self.worker_states.get(worker_id)
        state: dict[str, object] = {
            "worker_id": f"GOLD-{worker_id:02d}",
            "lifecycle": lifecycle,
            "action": action,
            "command_id": control.command_id if control else "",
            "batch_ref": batch_ref,
            "input_count": input_count,
            "snapshot_id": snapshot_id,
            "detail": detail,
            "step_index": step_index,
            "step_name": step_name,
        }
        # Ignore spurious updates that don't change functional fields
        comparable = {key: value for key, value in state.items() if key != "updated_at"}
        previous_comparable = {
            key: value for key, value in (previous or {}).items() if key != "updated_at"
        }
        if comparable == previous_comparable:
            return

        state["updated_at"] = utc_now()
        self.worker_states[worker_id] = state
        await self.publish_live(
            {
                "event_type": "gold.worker.lifecycle",
                "command_id": state["command_id"],
                "worker": state,
            }
        )

    async def observe_register(self, message) -> None:
        """Register a client UI ticket to receive live worker progress events."""
        try:
            ticket_id = str(
                json.loads(message.data.decode("utf-8")).get("ticket_id", "")
            ).strip()
        except (UnicodeDecodeError, json.JSONDecodeError, AttributeError):
            return
        if not ticket_id or len(ticket_id) > 128:
            return
        self.observer_tickets.add(ticket_id)
        for worker in self.worker_snapshots():
            await self.publish_live(
                {
                    "event_type": "gold.worker.lifecycle",
                    "command_id": worker.get("command_id", ""),
                    "worker": worker,
                },
                {ticket_id},
            )

    async def observe_unregister(self, message) -> None:
        """Unregister a client UI ticket when disconnects or moves away."""
        try:
            ticket_id = str(
                json.loads(message.data.decode("utf-8")).get("ticket_id", "")
            ).strip()
        except (UnicodeDecodeError, json.JSONDecodeError, AttributeError):
            return
        self.observer_tickets.discard(ticket_id)

    # -----------------------------------------------------------------
    # Pool Lifecycle & Worker Task Loops
    # -----------------------------------------------------------------

    async def start(self) -> None:
        """Subscribe to observation topics and launch worker concurrency coroutines."""
        await self.nc.subscribe(
            "aurora.observe.gold.register", cb=self.observe_register
        )
        await self.nc.subscribe(
            "aurora.observe.gold.unregister", cb=self.observe_unregister
        )
        self._workers = [
            asyncio.create_task(self._build_batch_loop(worker_id))
            for worker_id in range(1, self.config.worker_concurrency + 1)
        ]

    async def enqueue(self, batch: PendingBatch) -> None:
        """Enqueue an admitted batch to the worker pool for parallel processing."""
        if batch:
            await self.batch_queue.put(batch)
            self.queued_builds += 1
            self.metrics.set_queue_depth(self.batch_queue.qsize())

    async def update_idle_workers(self, control: EnrichmentControl) -> None:
        """Synchronize the state of idle worker slots with operator control (PAUSED/WAITING)."""
        idle_action = "FROZEN" if control.mode == "PAUSED" else "WAITING_FOR_BATCH"
        for worker_id, worker_state in list(self.worker_states.items()):
            if worker_state.get("lifecycle") == "KILLED" or worker_state.get(
                "action"
            ) not in {"WAITING_FOR_BATCH", "FROZEN"}:
                continue
            await self.set_worker_state(
                worker_id,
                action=idle_action,
                control=control,
                detail=(
                    "Worker slot retained but intake is frozen"
                    if control.mode == "PAUSED"
                    else "Waiting for an eligible LC/TPF batch"
                ),
                step_index=0,
                step_name="IDLE",
            )

    async def _build_batch_loop(self, worker_id: int) -> None:
        """Main loop for a single worker concurrency slot."""
        await self.set_worker_state(
            worker_id,
            lifecycle="SPAWNED",
            action="WAITING_FOR_BATCH",
            detail="Worker slot spawned and waiting for an eligible LC/TPF batch",
            step_index=0,
            step_name="IDLE",
        )
        try:
            while True:
                # Wait for an admitted batch from the scheduler queue
                batch = await self.batch_queue.get()
                batch_ref = batch[0][1].event_id if batch else ""
                await self.set_worker_state(
                    worker_id,
                    action="DEQUEUED_BATCH",
                    batch_ref=batch_ref,
                    input_count=len(batch),
                    detail="Claimed a durable Silver batch from the runtime queue",
                    step_index=1,
                    step_name="INTAKE",
                )
                await self._run_claimed_batch(worker_id, batch, batch_ref)
        finally:
            await self.set_worker_state(
                worker_id,
                lifecycle="KILLED",
                action="CANCELLED",
                detail="Worker task exited and no longer accepts batches",
                step_index=0,
                step_name="IDLE",
            )

    # -----------------------------------------------------------------
    # Batch Processing Pipeline Execution
    # -----------------------------------------------------------------

    async def _run_claimed_batch(
        self, worker_id: int, batch: PendingBatch, batch_ref: str
    ) -> None:
        """Execute the end-to-end scientific materialization for one batch."""
        batch_control: EnrichmentControl | None = None
        attempt_started_at: float | None = None
        attempt_finished_at: float | None = None
        attempt_status = "failed"
        successful_inputs = 0
        successful_rows = 0

        try:
            # 1. Gate check: If control is PAUSED, hold batch safely without discarding
            while (await self.control_getter()).mode == "PAUSED":
                await self.set_worker_state(
                    worker_id,
                    action="WAITING_FOR_RESUME",
                    batch_ref=batch_ref,
                    input_count=len(batch),
                    detail="Batch retained; operator control is paused",
                    step_index=1,
                    step_name="INTAKE",
                )
                await asyncio.sleep(1)

            self.active_builds += 1
            self.queued_builds = max(0, self.queued_builds - 1)
            self.metrics.set_queue_depth(self.batch_queue.qsize())
            self.metrics.build_started()
            attempt_started_at = time.monotonic()

            events = [event for _, event in batch]
            batch_control = await self.control_getter()

            # 2. Pairing verification
            await self.set_worker_state(
                worker_id,
                action="VERIFYING_PAIRING",
                control=batch_control,
                batch_ref=batch_ref,
                input_count=len(batch),
                detail="Validating multimodal LC and TPF context alignment",
                step_index=2,
                step_name="PAIRING",
            )
            paired_count = sum(event.product_kind == "LIGHT_CURVE" for event in events)
            self.metrics.record_pairing(paired_count)

            # 3. Synchronize immutable external catalogs (TIC & TOI)
            await self.set_worker_state(
                worker_id,
                action="SYNCING_CATALOGS",
                control=batch_control,
                batch_ref=batch_ref,
                input_count=len(batch),
                detail="Resolving immutable TIC and TOI evidence for this batch",
                step_index=3,
                step_name="CATALOG",
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

            self.catalog_sync = {
                "mode": "ON_DEMAND",
                "state": "SYNCING",
                "target_count": len(tic_ids),
                "tic_records": 0,
                "toi_records": 0,
                "snapshot_ids": {},
                "cache_hit": False,
                "error": "",
            }
            await self.report_status_cb(batch_control, "CATALOG_SYNCING")

            catalog_sync_start = time.perf_counter()
            catalog_result = await asyncio.to_thread(
                sync_catalogs_for_tics,
                self.store,
                self.config.minio_bucket,
                tic_ids,
            )
            catalog_elapsed = time.perf_counter() - catalog_sync_start
            self.metrics.record_catalog_sync(
                catalog_result.tic_records,
                catalog_result.toi_records,
                catalog_elapsed,
                cache_hit=catalog_result.cache_hit,
            )

            self.catalog_sync = {
                "mode": "ON_DEMAND",
                "state": "READY",
                "target_count": catalog_result.target_count,
                "tic_records": catalog_result.tic_records,
                "toi_records": catalog_result.toi_records,
                "snapshot_ids": catalog_result.catalogs.snapshot_ids,
                "cache_hit": catalog_result.cache_hit,
                "error": "",
            }
            await self.report_status_cb(batch_control, "RUNNING")

            # 4. Feature extraction & Parquet snapshot materialization (in ProcessPool)
            await self.set_worker_state(
                worker_id,
                action="EXTRACTING_FEATURES",
                control=batch_control,
                batch_ref=batch_ref,
                input_count=len(batch),
                detail="Extracting transit features and TPF centroid shifts",
                step_index=4,
                step_name="EXTRACT",
            )
            await self.set_worker_state(
                worker_id,
                action="MATERIALIZING_PARQUET",
                control=batch_control,
                batch_ref=batch_ref,
                input_count=len(batch),
                detail="Writing calibrated Gold Parquet tables to MinIO",
                step_index=5,
                step_name="PARQUET",
            )
            result = await asyncio.get_running_loop().run_in_executor(
                self.build_executor,
                _build_candidate_parquet,
                self.config,
                events,
                catalog_result.catalogs,
            )

            # Record phase metrics from build candidate execution
            self.metrics.record_step(
                "lc_features",
                result.lc_feature_duration_seconds,
                result.lightcurve_feature_rows,
            )
            self.metrics.record_step(
                "bls", result.lc_feature_duration_seconds, result.bls_evidence_rows
            )
            if result.bls_evidence_rows > 0:
                self.metrics.bls_candidates.inc(result.bls_evidence_rows)
            self.metrics.record_step(
                "tpf_vetting",
                result.tpf_duration_seconds,
                result.target_pixel_evidence_rows,
            )
            if result.target_pixel_evidence_rows > 0:
                self.metrics.tpf_transit_evidence.inc(result.target_pixel_evidence_rows)
            self.metrics.record_step(
                "candidate", result.assembly_duration_seconds, result.row_count
            )
            if result.row_count > 0:
                self.metrics.candidates_assembled.inc(result.row_count)
            self.metrics.record_parquet_write(
                result.parquet_duration_seconds, result.parquet_bytes
            )

            # 5. Indexing snapshot projections into ClickHouse (in ProcessPool)
            await self.set_worker_state(
                worker_id,
                action="INDEXING_CLICKHOUSE",
                control=batch_control,
                batch_ref=batch_ref,
                input_count=len(batch),
                snapshot_id=result.snapshot_id,
                detail="Projecting Gold candidate rows to ClickHouse real-time tables",
                step_index=6,
                step_name="INDEX",
            )
            ch_index_start = time.perf_counter()
            indexed_rows = await asyncio.get_running_loop().run_in_executor(
                self.build_executor,
                _project_candidate_clickhouse,
                self.config,
                result,
            )
            ch_index_elapsed = time.perf_counter() - ch_index_start
            self.metrics.record_clickhouse_index(ch_index_elapsed, indexed_rows)

            # 6. Commit snapshot and record durable pipeline run history
            completed_at = datetime.now(timezone.utc)
            await self.set_worker_state(
                worker_id,
                action="COMMITTING_SNAPSHOT",
                control=batch_control,
                batch_ref=batch_ref,
                input_count=len(batch),
                snapshot_id=result.snapshot_id,
                detail="Recording durable run history and publishing the committed snapshot",
                step_index=7,
                step_name="COMMIT",
            )
            await asyncio.to_thread(
                self.history.record_batch,
                batch_control,
                result,
                input_records=sum(
                    event.product_kind == "LIGHT_CURVE" for event in events
                ),
                indexed_rows=indexed_rows,
                started_at=started_at,
                completed_at=completed_at,
            )

            # 7. Publish committed event to JetStream & clean up pending checkpoints
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
            async with self.publish_lock:
                await self.js.publish("aurora.v1.gold.candidate.committed", payload)
                await self.nc.flush()

            builder = EnrichmentBuilder(
                store=self.store,
                default_bucket=self.config.minio_bucket,
                scratch_dir=self.config.scratch_dir,
            )
            await asyncio.to_thread(builder.clear_pending, batch)

            # 8. Success metrics and commit logging
            self.last_snapshot_id = result.snapshot_id
            self.last_error = ""
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
            await self.set_worker_state(
                worker_id,
                action="SNAPSHOT_COMMITTED",
                control=batch_control,
                batch_ref=batch_ref,
                input_count=len(batch),
                snapshot_id=result.snapshot_id,
                detail=f"Committed {indexed_rows} indexed Gold rows",
                step_index=7,
                step_name="COMMIT",
            )

        except CatalogSyncError as exc:
            # Catalog sync errors are transient: hold batch and retry safely
            attempt_status = "deferred"
            attempt_finished_at = time.monotonic()
            self.last_error = "Gold is waiting for verified TIC/TOI catalog evidence"
            self.catalog_sync = {
                **self.catalog_sync,
                "state": "RETRYING",
                "error": str(exc),
            }
            await self.set_worker_state(
                worker_id,
                action="RETRYING_CATALOG_SYNC",
                control=batch_control,
                batch_ref=batch_ref,
                input_count=len(batch),
                detail=str(exc),
                step_index=3,
                step_name="CATALOG",
            )
            if batch_control is not None and batch_control.command_id:
                await asyncio.to_thread(
                    self.history.record_run_state,
                    batch_control,
                    "WAITING_FOR_CATALOG_SYNC",
                    pending_inputs=len(batch),
                    active_builds=self.active_builds,
                    last_snapshot_id=self.last_snapshot_id,
                    last_error=self.last_error,
                )
                self.last_history_state = (
                    f"{batch_control.command_id}:WAITING_FOR_CATALOG_SYNC"
                )
                await self.report_status_cb(batch_control, "WAITING_FOR_CATALOG_SYNC")
            LOGGER.warning(
                "Catalog evidence is not ready; retaining Gold batch for retry "
                "(worker=%d targets=%d): %s",
                worker_id,
                len(batch),
                exc,
            )
            await asyncio.sleep(10)
            await self.enqueue(batch)

        except Exception:
            # General build failures: preserve durable checkpoints and schedule retry
            attempt_status = "failed"
            attempt_finished_at = time.monotonic()
            self.last_error = "Gold materialization failed; checkpoints retained"
            await self.set_worker_state(
                worker_id,
                action="FAILED_RETRY_SCHEDULED",
                control=batch_control,
                batch_ref=batch_ref,
                input_count=len(batch),
                detail=self.last_error,
                step_index=5,
                step_name="PARQUET",
            )
            if batch_control is not None and batch_control.command_id:
                await asyncio.to_thread(
                    self.history.record_run_state,
                    batch_control,
                    "FAILED",
                    pending_inputs=len(batch),
                    active_builds=self.active_builds,
                    last_snapshot_id=self.last_snapshot_id,
                    last_error=self.last_error,
                )
                self.last_history_state = f"{batch_control.command_id}:FAILED"
            LOGGER.exception(
                "Gold batch failed; durable checkpoints are retained for retry (worker=%d inputs=%d)",
                worker_id,
                len(batch),
            )
            await asyncio.sleep(5)
            await self.enqueue(batch)

        finally:
            # 9. Clean up slot and publish updated runtime state
            if attempt_started_at is not None:
                self.metrics.build_finished(
                    attempt_status,
                    (attempt_finished_at or time.monotonic()) - attempt_started_at,
                    input_records=successful_inputs,
                    output_rows=successful_rows,
                )
            self.active_builds = max(0, self.active_builds - 1)
            self.batch_queue.task_done()
            try:
                current_control = await self.control_getter()
                await self.set_worker_state(
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
                    step_index=0,
                    step_name="IDLE",
                )
                await self.report_status_cb(
                    current_control, self.observed_runtime_state_cb(current_control)
                )
            except Exception:
                LOGGER.exception(
                    "Unable to publish Gold runtime status after batch completion"
                )

    async def shutdown(self) -> None:
        """Cancel worker tasks and cleanly terminate the ProcessPoolExecutor."""
        for worker in self._workers:
            worker.cancel()
        await asyncio.gather(*self._workers, return_exceptions=True)
        self.build_executor.shutdown(wait=False, cancel_futures=True)
