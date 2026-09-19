"""Durable checkpoint queue management and lineage recovery for Enrichment.

Manages work tracking in MinIO object storage:
- Pending work checkpoints: `checkpoints/enrichment/pending/<event_id>.json`
- Historical backfill from committed Silver lineage: `lineage/v1/tess/*.json`
- Pruning of stale work that was already committed to an immutable Gold manifest.
"""

from __future__ import annotations

import hashlib
from typing import Any, Dict, Iterable

from events import SilverEvent, SilverEventError
from storage.object_store import ObjectStore

# Snapshot policy requirements
RESEARCH_READY_POLICY = "research-ready-target-pair-v4"
PENDING_CHECKPOINT_PREFIX = "checkpoints/enrichment/pending/"
LINEAGE_PREFIX = "lineage/v1/tess/"
SNAPSHOTS_PREFIX = "gold/snapshots/"


class EnrichmentCheckpointStore:
    """Manages pending work checkpoints and lineage recovery in object storage."""

    def __init__(self, store: ObjectStore, default_bucket: str):
        self.store = store
        self.default_bucket = default_bucket
        # Remember inspected lineage keys across restarts to avoid redundant S3 downloads
        self._observed_lineage_keys: set[str] = set()

    def save_pending(self, event: SilverEvent) -> None:
        """Persist an incoming Silver event as a durable pending checkpoint."""
        key = f"{PENDING_CHECKPOINT_PREFIX}{event.event_id}.json"
        self.store.put_json(event.bucket or self.default_bucket, key, event.to_dict())

    def pending_events(
        self, bucket: str | None = None
    ) -> list[tuple[str, SilverEvent]]:
        """List all pending work checkpoints currently stored in MinIO."""
        bucket = bucket or self.default_bucket
        events: list[tuple[str, SilverEvent]] = []
        for key in self.store.list_keys(bucket, PENDING_CHECKPOINT_PREFIX):
            payload = self.store.get_json(bucket, key)
            if payload is not None:
                events.append((key, SilverEvent.from_dict(payload)))
        return events

    def pending_unextracted_events(
        self, bucket: str | None = None
    ) -> list[tuple[str, SilverEvent]]:
        """Return only work not already committed to research-ready Gold snapshots.

        If a worker was interrupted after an immutable snapshot committed and
        ClickHouse projected, but before it could delete the pending checkpoint,
        those checkpoints would otherwise trigger duplicate materialization on restart.
        This method automatically detects and cleans up such stale checkpoints.
        """
        bucket = bucket or self.default_bucket
        extracted_keys = self._extracted_silver_keys(bucket)
        pending: list[tuple[str, SilverEvent]] = []
        for key, event in self.pending_events(bucket):
            if event.object_key in extracted_keys:
                self.store.delete(event.bucket or bucket, key)
                continue
            pending.append((key, event))
        return pending

    def recover_pending_from_lineage(
        self, bucket: str | None = None
    ) -> list[tuple[str, SilverEvent]]:
        """Seed the durable Enrichment queue from committed Silver lineage records.

        JetStream events are sufficient for newly-produced Silver, but they do
        not describe artifacts that existed before this worker instance was deployed.
        Lineage files in `lineage/v1/tess/*.json` are the durable, checksum-verified
        source of truth for those artifacts.
        """
        bucket = bucket or self.default_bucket
        lineage_keys = [
            key
            for key in self.store.list_keys(bucket, LINEAGE_PREFIX)
            if key.endswith(".json") and key not in self._observed_lineage_keys
        ]
        if not lineage_keys:
            return []

        pending = self.pending_events(bucket)
        pending_keys = {event.object_key for _, event in pending}
        extracted_keys = self._extracted_silver_keys(bucket)
        recovered: list[tuple[str, SilverEvent]] = []

        for lineage_key in lineage_keys:
            lineage = self.store.get_json(bucket, lineage_key)
            event = self._silver_event_from_lineage(lineage)
            self._observed_lineage_keys.add(lineage_key)

            if (
                event is None
                or event.object_key in pending_keys
                or event.object_key in extracted_keys
            ):
                continue

            self.save_pending(event)
            pending_key = f"{PENDING_CHECKPOINT_PREFIX}{event.event_id}.json"
            recovered.append((pending_key, event))
            pending_keys.add(event.object_key)

        return recovered

    def clear_pending(self, pending: Iterable[tuple[str, SilverEvent]]) -> None:
        """Remove committed Light Curve checkpoints from the pending queue.

        Note: TPF (Target Pixel) contexts are reusable spatial dependencies for later
        batches in the same sector; only LC queue entries are consumed and removed.
        """
        for key, event in pending:
            if key.startswith(PENDING_CHECKPOINT_PREFIX):
                self.store.delete(event.bucket or self.default_bucket, key)

    def _extracted_silver_keys(self, bucket: str) -> set[str]:
        """Return silver object keys already committed into research-ready Gold manifests."""
        keys: set[str] = set()
        for manifest_key in self.store.list_keys(bucket, SNAPSHOTS_PREFIX):
            if not manifest_key.endswith("/manifest.json"):
                continue
            manifest = self.store.get_json(bucket, manifest_key) or {}
            if str(manifest.get("status", "")).upper() != "COMMITTED":
                continue
            contract = manifest.get("completeness_contract") or {}
            if contract.get("policy") != RESEARCH_READY_POLICY:
                continue
            for item in manifest.get("inputs", []):
                object_key = str(item.get("silver_object_key", "")).strip()
                if object_key:
                    keys.add(object_key)
        return keys

    @staticmethod
    def _silver_event_from_lineage(
        lineage: Dict[str, Any] | None,
    ) -> SilverEvent | None:
        """Construct a validated SilverEvent from a durable Silver lineage JSON record."""
        if not lineage or str(lineage.get("status", "")).upper() != "LINEAGE_COMMITTED":
            return None

        source = lineage.get("source") or {}
        bronze = lineage.get("bronze") or {}
        processing = lineage.get("processing") or {}
        silver = lineage.get("silver") or {}
        lineage_id = str(lineage.get("lineage_id", "")).strip()
        if not lineage_id:
            return None

        event_payload = {
            "event_id": hashlib.sha256(
                f"gold-lineage-backfill:{lineage_id}".encode()
            ).hexdigest(),
            "event_type": "silver.object.ready",
            "source_event_id": str(lineage.get("preprocessing_checkpoint_id") or ""),
            "source_product_id": source.get("source_product_id"),
            "sample_id": None,
            "bucket": silver.get("bucket"),
            "object_key": silver.get("object_key"),
            "product_kind": bronze.get("product_kind")
            or processing.get("product_kind"),
            "schema_version": silver.get("schema_version"),
            "processor_version": silver.get("processor_version")
            or processing.get("processor_version"),
            "processing_fingerprint": processing.get("processing_fingerprint", ""),
            "sector": bronze.get("sector"),
            "tic_id": bronze.get("tic_id"),
            "camera": bronze.get("camera"),
            "ccd": bronze.get("ccd"),
            "size_bytes": silver.get("size_bytes"),
            "sha256": silver.get("sha256"),
            "occurred_at": lineage.get("committed_at", ""),
        }
        try:
            return SilverEvent.from_dict(event_payload)
        except (SilverEventError, TypeError, ValueError):
            return None
