"""Durable, queryable operational history for actual Gold Builder runs."""

from __future__ import annotations

from datetime import datetime, timezone
import logging
from threading import RLock
import clickhouse_connect

from ..application.control import GoldControl
from ..application.materializer import GoldBuildResult
from ..config import Config

LOGGER = logging.getLogger("aurora-factory-history")


class FactoryHistoryWriter:
    """Writes observed Gold run and batch facts to ClickHouse, never estimates."""

    def __init__(self, config: Config):
        # clickhouse-connect clients are not safe for concurrent queries. The
        # Gold worker emits runtime state from the control loop while build
        # tasks commit batches, so all history traffic must share one lock.
        self._lock = RLock()
        self.clickhouse = clickhouse_connect.get_client(
            host=config.clickhouse_host,
            port=config.clickhouse_port,
            username=config.clickhouse_user,
            password=config.clickhouse_password,
            database=config.clickhouse_database,
        )

    def ensure_schema(self) -> None:
        with self._lock:
            self.clickhouse.command(
                """CREATE TABLE IF NOT EXISTS pipeline_runs_v1 (
                pipeline LowCardinality(String), run_id String, mode LowCardinality(String),
                status LowCardinality(String), started_at DateTime64(3, 'UTC'),
                finished_at Nullable(DateTime64(3, 'UTC')), max_batch_records UInt32,
                idle_flush_seconds UInt32, pending_inputs UInt64, active_builds UInt32,
                completed_batches UInt32, input_records UInt64, output_rows UInt64,
                indexed_rows UInt64, last_snapshot_id String, last_error String,
                updated_at DateTime64(3, 'UTC')
            ) ENGINE = ReplacingMergeTree(updated_at)
            PARTITION BY toYYYYMM(started_at) ORDER BY (pipeline, run_id)"""
            )
            self.clickhouse.command(
                """CREATE TABLE IF NOT EXISTS pipeline_batches_v1 (
                pipeline LowCardinality(String), run_id String, batch_id String,
                mode LowCardinality(String), status LowCardinality(String),
                started_at DateTime64(3, 'UTC'), completed_at Nullable(DateTime64(3, 'UTC')),
                input_records UInt64, candidate_rows UInt64, artifact_count UInt32,
                indexed_rows UInt64, snapshot_id String, snapshot_fingerprint String,
                manifest_key String, manifest_sha256 String, error String,
                updated_at DateTime64(3, 'UTC')
            ) ENGINE = ReplacingMergeTree(updated_at)
            PARTITION BY toYYYYMM(started_at) ORDER BY (pipeline, run_id, batch_id)"""
            )
            self.clickhouse.command(
                """CREATE TABLE IF NOT EXISTS pipeline_component_events_v1 (
                pipeline LowCardinality(String), run_id String, component_id LowCardinality(String),
                status LowCardinality(String), occurred_at DateTime64(3, 'UTC'),
                input_records UInt64, output_rows UInt64, indexed_rows UInt64,
                snapshot_id String, error String
            ) ENGINE = MergeTree()
            PARTITION BY toYYYYMM(occurred_at) ORDER BY (pipeline, run_id, occurred_at, component_id)"""
            )

    def _component_event(
        self,
        run_id: str,
        component_id: str,
        status: str,
        *,
        input_records: int = 0,
        output_rows: int = 0,
        indexed_rows: int = 0,
        snapshot_id: str = "",
        error: str = "",
    ) -> None:
        self.clickhouse.insert(
            "pipeline_component_events_v1",
            [
                [
                    "silver_to_gold",
                    run_id,
                    component_id,
                    status,
                    datetime.now(timezone.utc),
                    max(0, input_records),
                    max(0, output_rows),
                    max(0, indexed_rows),
                    snapshot_id,
                    error,
                ]
            ],
            column_names=[
                "pipeline",
                "run_id",
                "component_id",
                "status",
                "occurred_at",
                "input_records",
                "output_rows",
                "indexed_rows",
                "snapshot_id",
                "error",
            ],
        )

    def record_run_state(
        self,
        control: GoldControl,
        state: str,
        *,
        pending_inputs: int,
        active_builds: int,
        last_snapshot_id: str = "",
        last_error: str = "",
    ) -> None:
        if not control.command_id:
            return
        with self._lock:
            now = datetime.now(timezone.utc)
            finished_at = now if state in {"FROZEN", "COMPLETED", "FAILED"} else None
            self.clickhouse.insert(
                "pipeline_runs_v1",
                [
                    [
                        "silver_to_gold",
                        control.command_id,
                        control.mode.lower(),
                        state,
                        now,
                        finished_at,
                        control.max_batch_records,
                        int(control.idle_flush_seconds),
                        max(0, pending_inputs),
                        max(0, active_builds),
                        0,
                        0,
                        0,
                        0,
                        last_snapshot_id,
                        last_error,
                        now,
                    ]
                ],
                column_names=[
                    "pipeline",
                    "run_id",
                    "mode",
                    "status",
                    "started_at",
                    "finished_at",
                    "max_batch_records",
                    "idle_flush_seconds",
                    "pending_inputs",
                    "active_builds",
                    "completed_batches",
                    "input_records",
                    "output_rows",
                    "indexed_rows",
                    "last_snapshot_id",
                    "last_error",
                    "updated_at",
                ],
            )
            self._component_event(
                control.command_id,
                "gold-batch",
                state,
                input_records=pending_inputs,
                snapshot_id=last_snapshot_id,
                error=last_error,
            )

    def record_batch(
        self,
        control: GoldControl,
        result: GoldBuildResult,
        *,
        input_records: int,
        indexed_rows: int,
        started_at: datetime,
        completed_at: datetime,
    ) -> None:
        if not control.command_id:
            return
        with self._lock:
            now = datetime.now(timezone.utc)
            self.clickhouse.insert(
                "pipeline_batches_v1",
                [
                    [
                        "silver_to_gold",
                        control.command_id,
                        result.snapshot_id,
                        control.mode.lower(),
                        "COMPLETED",
                        started_at,
                        completed_at,
                        input_records,
                        result.row_count,
                        result.artifact_count,
                        indexed_rows,
                        result.snapshot_id,
                        result.snapshot_fingerprint,
                        result.manifest_key,
                        result.manifest_sha256,
                        "",
                        now,
                    ]
                ],
                column_names=[
                    "pipeline",
                    "run_id",
                    "batch_id",
                    "mode",
                    "status",
                    "started_at",
                    "completed_at",
                    "input_records",
                    "candidate_rows",
                    "artifact_count",
                    "indexed_rows",
                    "snapshot_id",
                    "snapshot_fingerprint",
                    "manifest_key",
                    "manifest_sha256",
                    "error",
                    "updated_at",
                ],
            )
            self._component_event(
                control.command_id,
                "gold-features",
                "COMPLETED",
                input_records=input_records,
                output_rows=result.row_count,
                snapshot_id=result.snapshot_id,
            )
            self._component_event(
                control.command_id,
                "gold-commit",
                "COMPLETED",
                output_rows=result.row_count,
                indexed_rows=indexed_rows,
                snapshot_id=result.snapshot_id,
            )
        LOGGER.info(
            "Recorded Gold history run=%s batch=%s",
            control.command_id,
            result.snapshot_id,
        )
