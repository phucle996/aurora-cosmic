"""In-memory testing harness and service mocks for Aurora Enrichment benchmarks.

Provides completely in-memory, deterministic mocks for:
1. NATS JetStream (pull consumers, message acknowledgments, redelivery, stream management).
2. ClickHouse Client (query, command execution, row inserts, PyArrow table inserts).
3. Combined TestBenchHarness wiring MemoryObjectStore, simulated queues, and workers.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
import json
from typing import Any

import pyarrow as pa

from config import Config
from events import SilverEvent
from pipeline.materializer import EnrichmentBuilder
from runtime.readiness import MultimodalReadiness
from storage.checkpoints import EnrichmentCheckpointStore
from storage.object_store import MemoryObjectStore


@dataclass
class SimulatedQueryResult:
    """Mock result object matching clickhouse_connect query output."""

    result_rows: list[list[Any]] = field(default_factory=list)


class SimulatedClickHouseClient:
    """Zero-dependency in-memory mock of clickhouse_connect client.

    Captures executed commands, row inserts, and Arrow table inserts,
    supporting exact schema assertions and query verifications.
    """

    def __init__(self) -> None:
        self.commands: list[str] = []
        self.queries: list[str] = []
        self.inserted_rows: dict[str, list[list[Any]]] = {}
        self.inserted_tables: dict[str, list[pa.Table]] = {}
        self.ready_snapshots: set[str] = set()

    def command(
        self, cmd: str, parameters: dict[str, Any] | None = None, **kwargs: Any
    ) -> None:
        """Record an executed DDL/DML command."""
        self.commands.append(cmd)

    def query(
        self, query_str: str, parameters: dict[str, Any] | None = None
    ) -> SimulatedQueryResult:
        """Simulate query execution."""
        self.queries.append(query_str)
        # Handle gold_snapshots_v1 ready check
        if "count()" in query_str and "gold_snapshots_v1" in query_str:
            snapshot_id = (parameters or {}).get("snapshot", "")
            if snapshot_id in self.ready_snapshots:
                return SimulatedQueryResult(result_rows=[[1]])
            return SimulatedQueryResult(result_rows=[[0]])

        # Default empty result
        return SimulatedQueryResult(result_rows=[])

    def insert(
        self,
        table: str,
        data: list[Any],
        column_names: list[str] | None = None,
        **kwargs: Any,
    ) -> None:
        """Record rows inserted into a table."""
        self.inserted_rows.setdefault(table, []).extend(data)
        if table == "gold_snapshots_v1":
            for row in data:
                if len(row) > 0:
                    self.ready_snapshots.add(str(row[0]))

    def insert_arrow(self, table: str, arrow_table: pa.Table, **kwargs: Any) -> None:
        """Record PyArrow table inserted into ClickHouse."""
        self.inserted_tables.setdefault(table, []).append(arrow_table)

    def count_rows(self, table: str) -> int:
        """Total number of rows recorded for a table."""
        direct = len(self.inserted_rows.get(table, []))
        arrow_count = sum(t.num_rows for t in self.inserted_tables.get(table, []))
        return direct + arrow_count


class SimulatedMessage:
    """Mock JetStream message matching nats.aio.msg.Msg contract."""

    def __init__(self, data: bytes, subject: str = "aurora.v1.silver.lightcurve"):
        self.data = data
        self.subject = subject
        self.acked = False
        self.naked = False
        self.terminated = False

    async def ack(self) -> None:
        self.acked = True

    async def nak(self, delay: float | None = None) -> None:
        self.naked = True

    async def term(self) -> None:
        self.terminated = True


class SimulatedJetStreamSubscription:
    """Mock JetStream pull subscription queue."""

    def __init__(self) -> None:
        self.queue: asyncio.Queue[SimulatedMessage] = asyncio.Queue()

    def push(self, message: SimulatedMessage) -> None:
        self.queue.put_nowait(message)

    async def fetch(
        self, batch: int = 1, timeout: float | None = None
    ) -> list[SimulatedMessage]:
        """Fetch up to batch messages, respecting timeout."""
        messages: list[SimulatedMessage] = []
        try:
            # Wait for at least one message up to timeout
            msg = await asyncio.wait_for(self.queue.get(), timeout=timeout)
            messages.append(msg)
            # Drain additional available messages without blocking
            while len(messages) < batch:
                try:
                    messages.append(self.queue.get_nowait())
                except asyncio.QueueEmpty:
                    break
        except (asyncio.TimeoutError, TimeoutError):
            pass
        return messages


class SimulatedJetStream:
    """Mock JetStream context matching nats.js.JetStreamContext."""

    def __init__(self) -> None:
        self.subscriptions: dict[str, SimulatedJetStreamSubscription] = {}
        self.published: list[tuple[str, bytes]] = []

    async def pull_subscribe(
        self, subject: str, durable: str, stream: str | None = None
    ) -> SimulatedJetStreamSubscription:
        key = f"{subject}:{durable}"
        if key not in self.subscriptions:
            self.subscriptions[key] = SimulatedJetStreamSubscription()
        return self.subscriptions[key]

    async def add_stream(
        self, name: str, subjects: list[str] | None = None
    ) -> dict[str, Any]:
        return {"name": name, "subjects": subjects or []}

    async def publish(self, subject: str, payload: bytes) -> None:
        self.published.append((subject, payload))

    def enqueue_silver_event(
        self,
        event: SilverEvent,
        subject: str = "aurora.v1.silver.lightcurve",
        durable: str = "enrichment-gold-builder",
    ) -> SimulatedMessage:
        """Enqueue an event into the subscription."""
        key = f"aurora.v1.silver.>:{durable}"
        if key not in self.subscriptions:
            self.subscriptions[key] = SimulatedJetStreamSubscription()
        msg = SimulatedMessage(
            data=json.dumps(event.to_dict()).encode("utf-8"),
            subject=subject,
        )
        self.subscriptions[key].push(msg)
        return msg


class TestBenchHarness:
    """Integrated, in-memory execution test bench harness.

    Wires together MemoryObjectStore, SimulatedClickHouseClient, and SimulatedJetStream
    with pipeline components for zero-external-dependency benchmarking.
    """

    def __init__(self, bucket: str = "aurora") -> None:
        self.bucket = bucket
        self.store = MemoryObjectStore()
        self.clickhouse = SimulatedClickHouseClient()
        self.jetstream = SimulatedJetStream()
        self.config = Config(
            environment="bench",
            log_level="INFO",
            minio_endpoint="memory://",
            minio_access_key="mock",
            minio_secret_key="mock",
            minio_bucket=bucket,
            nats_url="memory://",
            clickhouse_host="memory",
            clickhouse_port=9000,
            clickhouse_user="default",
            clickhouse_password="",
            clickhouse_database="aurora",
            worker_concurrency=2,
            scratch_dir=".runtime/bench-scratch",
            durable="enrichment-gold-builder",
            stream="AURORA_SILVER",
            metrics_addr="127.0.0.1:0",
        )
        self.checkpoint_store = EnrichmentCheckpointStore(self.store, self.bucket)
        self.readiness = MultimodalReadiness(self.store, self.bucket)
        self.builder = EnrichmentBuilder(self.store)

    def stage_silver_lightcurve(
        self,
        tic_id: int,
        sector: int = 1,
        cadences: int = 1000,
        inject_transit: bool = True,
    ) -> SilverEvent:
        """Generate, store, and register a Silver Light Curve."""
        from benches.generator import generate_lightcurve_parquet

        parquet_bytes, sha256, event = generate_lightcurve_parquet(
            tic_id=tic_id,
            sector=sector,
            cadences=cadences,
            inject_transit=inject_transit,
        )
        self.store.put_bytes(
            self.bucket, event.object_key, parquet_bytes, "application/octet-stream"
        )
        self.checkpoint_store.save_pending(event)
        return event

    def stage_silver_tpf(
        self,
        tic_id: int,
        sector: int = 1,
        cadences: int = 1000,
        rows: int = 11,
        cols: int = 11,
    ) -> SilverEvent:
        """Generate, store, and register a Silver Target Pixel File."""
        from benches.generator import generate_tpf_parquet

        parquet_bytes, sha256, event = generate_tpf_parquet(
            tic_id=tic_id,
            sector=sector,
            cadences=cadences,
            rows=rows,
            cols=cols,
        )
        self.store.put_bytes(
            self.bucket, event.object_key, parquet_bytes, "application/octet-stream"
        )
        self.readiness.persist_context(event)
        return event

    def stage_target_pair(
        self,
        tic_id: int,
        sector: int = 1,
        lc_cadences: int = 1000,
        tpf_shape: tuple[int, int] = (11, 11),
        inject_transit: bool = True,
    ) -> tuple[SilverEvent, SilverEvent]:
        """Stage both Light Curve and Target Pixel File for a single TIC ID."""
        lc_event = self.stage_silver_lightcurve(
            tic_id, sector, lc_cadences, inject_transit
        )
        tpf_event = self.stage_silver_tpf(
            tic_id, sector, lc_cadences, tpf_shape[0], tpf_shape[1]
        )
        return lc_event, tpf_event

    def stage_catalogs(self, tic_ids: list[int]) -> None:
        """Import catalogs for TIC IDs into the in-memory object store."""
        from benches.generator import seed_catalogs

        seed_catalogs(self.store, self.bucket, tic_ids)
