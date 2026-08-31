"""Durable operator control contract for the Gold Builder."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict

from ..infrastructure.object_store import ObjectStore


CONTROL_KEY = "control/gold-builder.json"
STATUS_KEY = "control/gold-builder/status.json"
DEFAULT_IDLE_FLUSH_SECONDS = 180.0
DEFAULT_MAX_BATCH_RECORDS = 5000
VALID_MODES = {"PAUSED", "STREAM", "BATCH"}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass(frozen=True)
class GoldControl:
    """Desired Gold Builder mode, written by the API control plane."""

    mode: str = "PAUSED"
    max_batch_records: int = DEFAULT_MAX_BATCH_RECORDS
    idle_flush_seconds: float = DEFAULT_IDLE_FLUSH_SECONDS
    command_id: str = ""
    updated_at: str = ""
    requested_by: str = ""

    @classmethod
    def from_dict(cls, payload: Dict[str, Any] | None) -> "GoldControl":
        payload = payload or {}
        mode = str(payload.get("mode", "PAUSED")).upper()
        if mode not in VALID_MODES:
            mode = "PAUSED"
        try:
            idle_flush_seconds = float(
                payload.get("idle_flush_seconds", DEFAULT_IDLE_FLUSH_SECONDS)
            )
        except (TypeError, ValueError):
            idle_flush_seconds = DEFAULT_IDLE_FLUSH_SECONDS
        if idle_flush_seconds < 60 or idle_flush_seconds > 900:
            idle_flush_seconds = DEFAULT_IDLE_FLUSH_SECONDS
        try:
            max_batch_records = int(
                payload.get("max_batch_records", DEFAULT_MAX_BATCH_RECORDS)
            )
        except (TypeError, ValueError):
            max_batch_records = DEFAULT_MAX_BATCH_RECORDS
        if max_batch_records < 1 or max_batch_records > DEFAULT_MAX_BATCH_RECORDS:
            max_batch_records = DEFAULT_MAX_BATCH_RECORDS
        return cls(
            mode=mode,
            max_batch_records=max_batch_records,
            idle_flush_seconds=idle_flush_seconds,
            command_id=str(payload.get("command_id", "")),
            updated_at=str(payload.get("updated_at", "")),
            requested_by=str(payload.get("requested_by", "")),
        )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "schema_version": 1,
            "mode": self.mode,
            "max_batch_records": self.max_batch_records,
            "idle_flush_seconds": self.idle_flush_seconds,
            "command_id": self.command_id,
            "updated_at": self.updated_at,
            "requested_by": self.requested_by,
        }


def load_control(store: ObjectStore, bucket: str) -> GoldControl:
    return GoldControl.from_dict(store.get_json(bucket, CONTROL_KEY))


def save_control(store: ObjectStore, bucket: str, control: GoldControl) -> None:
    store.put_json(bucket, CONTROL_KEY, control.to_dict())


def save_runtime_status(
    store: ObjectStore,
    bucket: str,
    *,
    state: str,
    control: GoldControl,
    pending_by_kind: Dict[str, int],
    active_builds: int,
    readiness: Dict[str, Any] | None = None,
    catalog_sync: Dict[str, Any] | None = None,
    first_silver_at: str = "",
    last_silver_at: str = "",
    next_flush_at: str = "",
    last_snapshot_id: str = "",
    last_error: str = "",
) -> None:
    store.put_json(
        bucket,
        STATUS_KEY,
        {
            "schema_version": 2,
            "state": state,
            "mode": control.mode,
            "max_batch_records": control.max_batch_records,
            "idle_flush_seconds": control.idle_flush_seconds,
            "command_id": control.command_id,
            "pending_total": sum(pending_by_kind.values()),
            "pending_by_kind": dict(sorted(pending_by_kind.items())),
            # Pending LC checkpoints and reusable TPF context are
            # intentionally different states.  Preserve both so the control
            # plane never mistakes a waiting target for a missing event.
            "readiness": readiness or {},
            "catalog_sync": catalog_sync or {"mode": "ON_DEMAND", "state": "IDLE"},
            "active_builds": active_builds,
            "first_silver_at": first_silver_at,
            "last_silver_at": last_silver_at,
            "next_flush_at": next_flush_at,
            "last_snapshot_id": last_snapshot_id,
            "last_error": last_error,
            "updated_at": utc_now(),
        },
    )
