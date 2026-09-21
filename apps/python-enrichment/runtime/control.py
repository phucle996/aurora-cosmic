"""Durable operator control contract for the Enrichment / Gold Builder.

The control plane (Go API) communicates intent to the Enrichment worker
via immutable/replacing JSON objects in MinIO:
- `control/enrichment.json`: Desired run mode (PAUSED, STREAM, BATCH) and limits.
- `control/enrichment/status.json`: Actual observed runtime telemetry and worker health.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict

from storage.object_store import ObjectStore

# MinIO key contracts shared with Go API and frontend DAG
CONTROL_KEY = "control/enrichment.json"
STATUS_KEY = "control/enrichment/status.json"

DEFAULT_IDLE_FLUSH_SECONDS = 180.0
DEFAULT_MAX_BATCH_RECORDS = 5000
VALID_MODES = {"PAUSED", "STREAM", "BATCH"}


def utc_now() -> str:
    """Return ISO 8601 formatted UTC timestamp."""
    return datetime.now(timezone.utc).isoformat()


@dataclass(frozen=True)
class EnrichmentControl:
    """Desired Enrichment Builder mode, written by the API control plane.

    Parameters:
    - mode: "PAUSED" (freeze intake), "STREAM" (continuous wave batching), "BATCH" (run until backlog clears then pause).
    - max_batch_records: Target Light Curve records per immutable snapshot.
    - idle_flush_seconds: Seconds of upstream silence before flushing a partial batch.
    - ticket_id / command_id: Correlates user actions with durable history in ClickHouse.
    """

    mode: str = "PAUSED"
    max_batch_records: int = DEFAULT_MAX_BATCH_RECORDS
    idle_flush_seconds: float = DEFAULT_IDLE_FLUSH_SECONDS
    ticket_id: str = ""
    command_id: str = ""
    updated_at: str = ""
    requested_by: str = ""

    @classmethod
    def from_dict(cls, payload: Dict[str, Any] | None) -> "EnrichmentControl":
        """Parse control document with safe guardrails against malformed inputs."""
        payload = payload or {}
        mode = str(payload.get("mode", "PAUSED")).upper()
        if mode not in VALID_MODES:
            mode = "PAUSED"

        # Clamp idle flush between 60s (1 min) and 900s (15 min)
        try:
            idle_flush_seconds = float(
                payload.get("idle_flush_seconds", DEFAULT_IDLE_FLUSH_SECONDS)
            )
        except (TypeError, ValueError):
            idle_flush_seconds = DEFAULT_IDLE_FLUSH_SECONDS
        if idle_flush_seconds < 60 or idle_flush_seconds > 900:
            idle_flush_seconds = DEFAULT_IDLE_FLUSH_SECONDS

        # Clamp max batch records between 1 and 5000
        try:
            max_batch_records = int(
                payload.get("max_batch_records", DEFAULT_MAX_BATCH_RECORDS)
            )
        except (TypeError, ValueError):
            max_batch_records = DEFAULT_MAX_BATCH_RECORDS
        if max_batch_records < 1 or max_batch_records > DEFAULT_MAX_BATCH_RECORDS:
            max_batch_records = DEFAULT_MAX_BATCH_RECORDS

        ticket_id = str(payload.get("ticket_id", ""))
        command_id = str(payload.get("command_id", "")) or ticket_id

        return cls(
            mode=mode,
            max_batch_records=max_batch_records,
            idle_flush_seconds=idle_flush_seconds,
            ticket_id=ticket_id,
            command_id=command_id,
            updated_at=str(payload.get("updated_at", "")),
            requested_by=str(payload.get("requested_by", "")),
        )

    def to_dict(self) -> Dict[str, Any]:
        """Convert control state to serializable JSON dictionary."""
        data: Dict[str, Any] = {
            "schema_version": 1,
            "mode": self.mode,
            "max_batch_records": self.max_batch_records,
            "idle_flush_seconds": self.idle_flush_seconds,
            "command_id": self.command_id or self.ticket_id,
            "updated_at": self.updated_at,
            "requested_by": self.requested_by,
        }
        if self.ticket_id:
            data["ticket_id"] = self.ticket_id
        return data


def load_control(store: ObjectStore, bucket: str) -> EnrichmentControl:
    """Load latest operator control state from MinIO."""
    return EnrichmentControl.from_dict(store.get_json(bucket, CONTROL_KEY))


def save_control(store: ObjectStore, bucket: str, control: EnrichmentControl) -> None:
    """Persist updated operator control state to MinIO."""
    store.put_json(bucket, CONTROL_KEY, control.to_dict())


def save_runtime_status(
    store: ObjectStore,
    bucket: str,
    *,
    state: str,
    control: EnrichmentControl,
    pending_by_kind: Dict[str, int],
    active_builds: int,
    workers: list[Dict[str, Any]] | None = None,
    readiness: Dict[str, Any] | None = None,
    catalog_sync: Dict[str, Any] | None = None,
    first_silver_at: str = "",
    last_silver_at: str = "",
    next_flush_at: str = "",
    last_snapshot_id: str = "",
    last_error: str = "",
) -> None:
    """Save observed runtime telemetry to MinIO for API querying and UI visualization."""
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
            # intentionally different states. Preserve both so the control
            # plane never mistakes a waiting target for a missing event.
            "readiness": readiness or {},
            "catalog_sync": catalog_sync or {"mode": "ON_DEMAND", "state": "IDLE"},
            "active_builds": active_builds,
            "workers": workers or [],
            "first_silver_at": first_silver_at,
            "last_silver_at": last_silver_at,
            "next_flush_at": next_flush_at,
            "last_snapshot_id": last_snapshot_id,
            "last_error": last_error,
            "updated_at": utc_now(),
        },
    )
