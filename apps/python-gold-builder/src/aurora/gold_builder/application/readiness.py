"""Durable multimodal eligibility for one-shot research-ready Gold builds."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterable

from ..domain.events import SilverEvent
from ..infrastructure.object_store import ObjectStore

PendingEvent = tuple[str, SilverEvent]
ReadyBatch = list[PendingEvent]
CONTEXT_PREFIX = "checkpoints/gold-builder/modalities/"
INGESTION_CURRENT_KEY = "checkpoints/ingestion/current.json"
INGESTION_RUN_PREFIX = "checkpoints/ingestion/runs/"


@dataclass(frozen=True)
class IngestionContract:
    """Expected upstream evidence for one LC, recovered from ingest state."""

    target_pixel_source_id: str | None


@dataclass(frozen=True)
class ReadinessSummary:
    state: str
    waiting_lightcurves: int
    ready_lightcurves: int
    missing_tpf: int
    catalog_ready: bool
    tic_catalog_ready: bool
    toi_catalog_ready: bool
    tpf_contexts: int
    contracted_lightcurves: int
    uncontracted_lightcurves: int


class MultimodalReadiness:
    """Keeps reusable TPF inputs while LC records wait for a complete pair.

    A Silver event proves the corresponding download and preprocessing commit
    completed. Gold is one-shot: a pending LC becomes eligible only when its
    paired TPF is available.  TIC and TOI evidence is synchronized later for
    exactly the ready batch, then pinned by the materializer.
    """

    def __init__(self, store: ObjectStore, bucket: str):
        self.store = store
        self.bucket = bucket
        self._contexts: dict[str, tuple[str, SilverEvent]] = {}
        self._contracts_by_lightcurve: dict[str, IngestionContract] = {}
        self._active_ingestion_token = ""
        self.reload()

    @staticmethod
    def _context_key(event: SilverEvent) -> str:
        return f"{CONTEXT_PREFIX}{event.product_kind.lower()}/{event.revision_id}.json"

    @staticmethod
    def _revision_sort_key(event: SilverEvent) -> tuple[datetime, str]:
        """Order retries/reprocessing deterministically, never by object listing order."""
        try:
            occurred_at = datetime.fromisoformat(
                event.occurred_at.replace("Z", "+00:00")
            )
            if occurred_at.tzinfo is None:
                occurred_at = occurred_at.replace(tzinfo=timezone.utc)
        except ValueError:
            occurred_at = datetime.min.replace(tzinfo=timezone.utc)
        return occurred_at, event.revision_id

    def reload(self) -> None:
        self._contexts.clear()
        for key in self.store.list_keys(self.bucket, CONTEXT_PREFIX):
            payload = self.store.get_json(self.bucket, key)
            if not payload:
                continue
            try:
                event = SilverEvent.from_dict(payload)
            except (TypeError, ValueError):
                continue
            self._contexts[event.revision_id] = (key, event)
        self._contracts_by_lightcurve.clear()
        self._active_ingestion_token = ""
        for key in self.store.list_keys(self.bucket, INGESTION_RUN_PREFIX):
            checkpoint = self.store.get_json(self.bucket, key)
            if checkpoint:
                self._register_ingestion_contract(checkpoint)
        self._refresh_active_ingestion_contract()

    def _register_ingestion_contract(self, checkpoint: dict) -> None:
        """Index the exact TPF source ID planned for every light curve.

        Ingestion checkpoints already contain the durable manifest footprint.
        Gold uses that contract only to decide completeness; it still waits for
        actual Silver context events before materializing an immutable snapshot.
        """
        products = checkpoint.get("products")
        if not isinstance(products, dict):
            return
        tpf_by_sample: dict[str, str] = {}
        lightcurves: list[tuple[str, str]] = []
        for product in products.values():
            if not isinstance(product, dict):
                continue
            source_id = str(product.get("source_product_id") or "")
            kind = str(product.get("product_kind") or "").upper()
            sample_id = str(product.get("sample_id") or "")
            if not source_id:
                continue
            if kind == "TARGET_PIXEL" and sample_id:
                tpf_by_sample[sample_id] = source_id
            elif kind == "LIGHT_CURVE":
                lightcurves.append((source_id, sample_id))
        for source_id, sample_id in lightcurves:
            self._contracts_by_lightcurve[source_id] = IngestionContract(
                target_pixel_source_id=tpf_by_sample.get(sample_id),
            )

    def _refresh_active_ingestion_contract(self) -> None:
        """Refresh only when the active manifest/run changes, not per event."""
        pointer = self.store.get_json(self.bucket, INGESTION_CURRENT_KEY)
        if not pointer:
            return
        run_id = str(pointer.get("active_run_id") or "")
        manifest_hash = str(pointer.get("manifest_hash") or "")
        last_updated_at = str(pointer.get("last_updated_at") or "")
        token = f"{run_id}:{manifest_hash}:{last_updated_at}"
        if not run_id or token == self._active_ingestion_token:
            return
        checkpoint = self.store.get_json(
            self.bucket, f"{INGESTION_RUN_PREFIX}{run_id}.json"
        )
        if checkpoint:
            self._register_ingestion_contract(checkpoint)
        self._active_ingestion_token = token

    def persist_context(self, event: SilverEvent) -> tuple[str, SilverEvent]:
        key = self._context_key(event)
        self.store.put_json(self.bucket, key, event.to_dict())
        item = (key, event)
        self._contexts[event.revision_id] = item
        return item

    def collect_ready(
        self, pending_lightcurves: Iterable[PendingEvent], max_targets: int
    ) -> tuple[list[ReadyBatch], ReadinessSummary]:
        self._refresh_active_ingestion_contract()
        tpf_by_sample: dict[str, PendingEvent] = {}
        tpf_by_source: dict[str, PendingEvent] = {}
        for item in sorted(
            self._contexts.values(),
            key=lambda context: self._revision_sort_key(context[1]),
        ):
            _, event = item
            if event.product_kind == "TARGET_PIXEL" and event.effective_sample_id:
                previous_sample = tpf_by_sample.get(event.effective_sample_id)
                if previous_sample is None or self._revision_sort_key(
                    event
                ) > self._revision_sort_key(previous_sample[1]):
                    tpf_by_sample[event.effective_sample_id] = item
                previous_source = tpf_by_source.get(event.source_product_id)
                if previous_source is None or self._revision_sort_key(
                    event
                ) > self._revision_sort_key(previous_source[1]):
                    tpf_by_source[event.source_product_id] = item
        candidates: list[ReadyBatch] = []
        missing_tpf = 0
        waiting = 0
        contracted_lightcurves = 0
        uncontracted_lightcurves = 0
        for lc_item in pending_lightcurves:
            _, lightcurve = lc_item
            contract = self._contracts_by_lightcurve.get(lightcurve.source_product_id)
            if contract is None:
                uncontracted_lightcurves += 1
                sample_id = lightcurve.effective_sample_id
                tpf = tpf_by_sample.get(sample_id or "")
            else:
                contracted_lightcurves += 1
                tpf = (
                    tpf_by_source.get(contract.target_pixel_source_id)
                    if contract.target_pixel_source_id
                    else None
                )
            if tpf is None:
                missing_tpf += 1
                waiting += 1
                continue
            candidates.append([lc_item, tpf])

        batches: list[ReadyBatch] = []
        for index in range(0, len(candidates), max_targets):
            grouped = candidates[index : index + max_targets]
            inputs: ReadyBatch = []
            seen: set[str] = set()
            for group in grouped:
                for item in group:
                    if item[1].event_id in seen:
                        continue
                    inputs.append(item)
                    seen.add(item[1].event_id)
            batches.append(inputs)
        if missing_tpf:
            state = "WAITING_FOR_TPF"
        elif candidates:
            state = "READY"
        else:
            state = "IDLE"
        return batches, ReadinessSummary(
            state=state,
            waiting_lightcurves=waiting,
            ready_lightcurves=len(candidates),
            missing_tpf=missing_tpf,
            # Catalog status is batch-scoped and reported by the worker's
            # catalog_sync status. These legacy fields remain false rather
            # than pretending a global pointer represents a ready batch.
            catalog_ready=False,
            tic_catalog_ready=False,
            toi_catalog_ready=False,
            tpf_contexts=len(tpf_by_sample),
            contracted_lightcurves=contracted_lightcurves,
            uncontracted_lightcurves=uncontracted_lightcurves,
        )
