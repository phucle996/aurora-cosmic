"""Silver-to-Gold materialization orchestration."""

from __future__ import annotations

from dataclasses import dataclass, field, replace
import hashlib
import io
import json
from pathlib import Path
import tempfile
from typing import Any, Dict, Iterable, List, Sequence

import numpy as np
import pyarrow.parquet as pq

from aurora_ml.pipeline.features import extract_features_from_silver
from aurora_ml.pipeline.catalogs import enrich_candidate
from aurora_ml.pipeline.gold import GoldSnapshotPlanner
from aurora_ml.pipeline.gold_materialize import (
    get_candidate_arrow_schema,
    write_partition_parquet,
)

from ..domain.events import SilverEvent, SilverEventError
from ..infrastructure.object_store import ObjectStore
from .catalogs import CatalogBundle
from .tpf_features import TpfFeatureError, extract_tpf_row


class GoldBuildError(RuntimeError):
    """Raised when a Gold snapshot cannot be committed safely."""


RESEARCH_READY_POLICY = "research-ready-target-pair-v4"
CATALOG_ENRICHMENT_VERSION = "catalog-enrichment-v4"
TPF_FEATURE_VERSION = "tpf-vetting-v2"
GOLD_SCHEMA_VERSION = "gold-candidate-v4"


@dataclass(frozen=True)
class GoldBuildResult:
    snapshot_id: str
    snapshot_fingerprint: str
    manifest_key: str
    manifest_sha256: str
    row_count: int
    artifact_count: int
    set_current: bool
    dataset_row_counts: Dict[str, int] = field(default_factory=dict)


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _column_values(table, name: str) -> list[Any]:
    if name not in table.column_names:
        raise GoldBuildError(f"Silver Parquet is missing required column '{name}'")
    return table.column(name).combine_chunks().to_pylist()


def _numeric_array(values: Sequence[Any], dtype: Any) -> np.ndarray:
    converted = [np.nan if value is None else value for value in values]
    return np.asarray(converted, dtype=dtype)


def _default_candidate_row() -> Dict[str, Any]:
    # Candidate schema deliberately keeps nullable scientific/catalog values
    # nullable while booleans are explicit false when evidence is absent.
    row: Dict[str, Any] = {}
    for schema_field in get_candidate_arrow_schema():
        if str(schema_field.type) == "bool":
            row[schema_field.name] = False
        else:
            row[schema_field.name] = None
    return row


class GoldBuilder:
    """Build immutable candidate Gold snapshots from verified Silver artifacts."""

    def __init__(
        self,
        store: ObjectStore,
        default_bucket: str = "aurora",
        feature_version: str = "lc-features-v1",
        bls_min_period_days: float = 0.5,
        bls_max_period_days: float = 20.0,
        bls_min_points: int = 100,
        scratch_dir: str | Path | None = None,
    ):
        self.store = store
        self.default_bucket = default_bucket
        self.feature_version = feature_version
        self.bls_min_period_days = bls_min_period_days
        self.bls_max_period_days = bls_max_period_days
        self.bls_min_points = bls_min_points
        self.scratch_dir = scratch_dir
        # Lineage objects are immutable. Remember which keys this long-lived
        # builder has inspected so a paused control plane can discover newly
        # committed Silver without repeatedly downloading the full history.
        self._observed_lineage_keys: set[str] = set()

    def _read_silver_table(self, event: SilverEvent):
        bucket = event.bucket or self.default_bucket
        data = self.store.get_bytes(bucket, event.object_key)
        actual_sha = _sha256(data)
        if actual_sha != event.sha256:
            raise GoldBuildError(
                f"Silver checksum mismatch for {event.object_key}: "
                f"expected {event.sha256}, got {actual_sha}"
            )
        try:
            return pq.read_table(io.BytesIO(data))
        except Exception as exc:
            raise GoldBuildError(
                f"Unable to read Silver Parquet {event.object_key}: {exc}"
            ) from exc

    def _lightcurve_features(self, event: SilverEvent):
        table = self._read_silver_table(event)
        time_values = _column_values(table, "time")
        flux_values = _column_values(table, "flux")
        flux_err_values = _column_values(table, "flux_err")
        flux_err = _numeric_array(flux_err_values, np.float64)
        if not np.isfinite(flux_err).any():
            flux_err = None

        ref = event.to_input_ref()
        features = extract_features_from_silver(
            ref,
            _numeric_array(time_values, np.float64),
            _numeric_array(flux_values, np.float64),
            flux_err,
            feature_version=self.feature_version,
            bls_min_period_days=self.bls_min_period_days,
            bls_max_period_days=self.bls_max_period_days,
            bls_min_points=self.bls_min_points,
        )

        # Silver event metadata is the authoritative product identity. Some
        # historical ingest runs encode it as ``sample:tic=<id>:sector=<n>``;
        # the generic feature parser only understood the older ``tic:<id>``
        # form. Preserve the scientific features while canonicalizing identity
        # before any catalog match or training label is derived.
        if features.tic_id not in {None, event.tic_id}:
            raise GoldBuildError(
                "Light-curve feature TIC identity conflicts with Silver event: "
                f"{features.tic_id} != {event.tic_id}"
            )
        return replace(features, tic_id=event.tic_id, sector=int(event.sector))

    @staticmethod
    def _event_keys(event: SilverEvent) -> list[tuple[Any, ...]]:
        """Return stable keys used to pair LC and TPF artifacts."""
        keys: list[tuple[Any, ...]] = []
        sample_id = event.effective_sample_id
        if sample_id:
            keys.append(("sample", sample_id))
        if event.tic_id is not None:
            keys.append(("tic-sector", int(event.tic_id), int(event.sector)))
        return keys

    @classmethod
    def _pair_lightcurve(
        cls,
        event: SilverEvent,
        lightcurves_by_key: Dict[tuple[Any, ...], list[tuple[SilverEvent, Any]]],
    ) -> tuple[SilverEvent, Any] | None:
        """Pair one image product with exactly one LC, otherwise leave unpaired."""
        candidates: Dict[str, tuple[SilverEvent, Any]] = {}
        for key in cls._event_keys(event):
            for lc_event, features in lightcurves_by_key.get(key, []):
                candidates[lc_event.source_product_id] = (lc_event, features)
        if len(candidates) == 1:
            return next(iter(candidates.values()))
        return None

    @staticmethod
    def _candidate_tpf_evidence(tpf_row: Dict[str, Any]) -> Dict[str, Any]:
        """Project verified TPF features into the canonical candidate row."""
        return {
            "pixel_mad_median": tpf_row.get("pixel_mad_median"),
            "variability_peak_fraction": tpf_row.get("variability_peak_fraction"),
            "transit_evidence_available": bool(
                tpf_row.get("transit_evidence_available")
            ),
            "transit_deficit_sum": tpf_row.get("transit_deficit_sum"),
            "transit_deficit_centroid_row": tpf_row.get("transit_deficit_centroid_row"),
            "transit_deficit_centroid_col": tpf_row.get("transit_deficit_centroid_col"),
            "transit_deficit_center_offset_pixels": tpf_row.get(
                "transit_deficit_center_offset_pixels"
            ),
        }

    def _tpf_row(
        self,
        event: SilverEvent,
        lc_features: Any | None,
    ) -> Dict[str, Any]:
        try:
            return extract_tpf_row(
                self.store,
                event,
                lc_features,
            scratch_dir=self.scratch_dir,
            feature_version=TPF_FEATURE_VERSION,
            )
        except TpfFeatureError as exc:
            raise GoldBuildError(str(exc)) from exc

    def _put_immutable(
        self, bucket: str, key: str, data: bytes, content_type: str
    ) -> str:
        digest = _sha256(data)
        try:
            existing = self.store.get_bytes(bucket, key)
        except Exception:
            existing = None
        if existing is not None:
            if _sha256(existing) != digest:
                raise GoldBuildError(
                    f"Immutable Gold artifact conflict at {bucket}/{key}"
                )
            return digest
        self.store.put_bytes(bucket, key, data, content_type)
        return digest

    def _write_dataset(
        self,
        plan: Any,
        bucket: str,
        dataset: str,
        schema: Any,
        rows: List[Dict[str, Any]],
        temp_dir: str,
    ) -> List[Dict[str, Any]]:
        if not rows:
            return []
        rows_by_sector: Dict[int, List[Dict[str, Any]]] = {}
        for row in rows:
            rows_by_sector.setdefault(int(row.get("sector") or 1), []).append(row)

        records: List[Dict[str, Any]] = []
        for sector, sector_rows in sorted(rows_by_sector.items()):
            local_path = Path(temp_dir) / f"{dataset}-{sector:04d}.parquet"
            row_count, content_sha, parquet_sha, size_bytes = write_partition_parquet(
                schema=schema,
                rows=sector_rows,
                dest_path=str(local_path),
                dataset_name=dataset,
                sector=sector,
            )
            artifact_key = (
                f"gold/snapshots/{plan.snapshot_id}/data/candidate/"
                f"sector={sector:04d}/part-00000.parquet"
            )
            artifact_bytes = local_path.read_bytes()
            if _sha256(artifact_bytes) != parquet_sha:
                raise GoldBuildError(
                    f"Local Gold artifact hash changed for {dataset} sector {sector}"
                )
            self._put_immutable(
                bucket,
                artifact_key,
                artifact_bytes,
                "application/vnd.apache.parquet",
            )
            records.append(
                {
                    "dataset": dataset,
                    "sector": sector,
                    "object_key": artifact_key,
                    "row_count": row_count,
                    "content_sha256": content_sha,
                    "parquet_sha256": parquet_sha,
                    "size_bytes": size_bytes,
                }
            )
        return records

    def build_candidate(
        self,
        events: Iterable[SilverEvent],
        set_current: bool = False,
        catalogs: CatalogBundle | None = None,
    ) -> GoldBuildResult:
        """Build one candidate snapshot from complete LC + TPF Silver pairs."""
        unique: Dict[str, SilverEvent] = {}
        for event in events:
            unique_key = f"{event.product_kind}:{event.source_product_id}"
            previous = unique.get(unique_key)
            if previous is not None and previous.sha256 != event.sha256:
                raise GoldBuildError(
                    f"Conflicting Silver artifacts for {event.source_product_id}"
                )
            unique[unique_key] = event
        selected = sorted(unique.values(), key=lambda event: event.source_product_id)
        if not selected:
            raise GoldBuildError("No Silver events available for Gold")
        bucket = selected[0].bucket or self.default_bucket
        # A Gold snapshot is valid only with the exact verified TIC/TOI bundle
        # selected for its batch.  Do not fall back to a mutable/global pointer:
        # that would make retries and ML provenance non-reproducible.
        if catalogs is None:
            raise GoldBuildError(
                "Research-ready Gold requires verified batch-scoped catalog snapshots"
            )

        lc_events = [e for e in selected if e.product_kind == "LIGHT_CURVE"]
        tpf_events = [e for e in selected if e.product_kind == "TARGET_PIXEL"]
        if not lc_events:
            raise GoldBuildError(
                "Research-ready Gold requires at least one LIGHT_CURVE"
            )
        missing_catalogs = [kind for kind in ("TIC", "TOI") if not catalogs.has(kind)]
        if missing_catalogs:
            raise GoldBuildError(
                "Research-ready Gold requires verified immutable catalog snapshots: "
                + ", ".join(missing_catalogs)
            )
        lc_features_by_source = {
            event.source_product_id: self._lightcurve_features(event)
            for event in lc_events
        }
        lc_by_key: Dict[tuple[Any, ...], list[tuple[SilverEvent, Any]]] = {}
        for event in lc_events:
            features = lc_features_by_source[event.source_product_id]
            for key in self._event_keys(event):
                lc_by_key.setdefault(key, []).append((event, features))

        # This is a defensive gate in addition to worker readiness. Every
        # selected LC must be paired with a TPF in this build.
        tpf_pairs: Dict[str, tuple[SilverEvent, Any, str | None]] = {}
        for event in tpf_events:
            paired = self._pair_lightcurve(event, lc_by_key)
            if paired is None:
                raise GoldBuildError(
                    "Research-ready Gold received an unpaired TARGET_PIXEL "
                    f"input: {event.source_product_id}"
                )
            tpf_pairs[event.source_product_id] = (paired[0], paired[1], None)

        paired_lc_sources = {pair[0].source_product_id for pair in tpf_pairs.values()}
        missing_tpf_sources = [
            event.source_product_id
            for event in lc_events
            if event.source_product_id not in paired_lc_sources
        ]
        if missing_tpf_sources:
            raise GoldBuildError(
                "Research-ready Gold is missing paired TARGET_PIXEL evidence for "
                + ", ".join(sorted(missing_tpf_sources)[:5])
            )
        referenced_lcs = [pair[0] for pair in tpf_pairs.values()]
        refs_by_key = {
            f"{event.product_kind}:{event.source_product_id}": event.to_input_ref()
            for event in [*selected, *referenced_lcs]
        }
        refs = list(refs_by_key.values())
        present_kinds = {event.product_kind for event in [*selected, *referenced_lcs]}
        feature_versions = {
            key: version
            for key, version, kind in (
                ("lc", self.feature_version, "LIGHT_CURVE"),
                ("tpf", TPF_FEATURE_VERSION, "TARGET_PIXEL"),
            )
            if kind in present_kinds
        }
        feature_versions["catalog"] = CATALOG_ENRICHMENT_VERSION
        plan = GoldSnapshotPlanner().plan_snapshot(
            snapshot_type="CANDIDATE",
            gold_schema_version=GOLD_SCHEMA_VERSION,
            feature_versions=feature_versions,
            inputs=refs,
            catalog_snapshots=catalogs.snapshot_ids,
            label_snapshots={
                kind: snapshot_id
                for kind, snapshot_id in catalogs.snapshot_ids.items()
                if kind in {"TOI", "TCE"}
            },
            producer="python-gold-builder",
        )

        tpf_rows: List[Dict[str, Any]] = []
        evidence_by_lightcurve: Dict[str, Dict[str, Any]] = {}
        for event in tpf_events:
            pair = tpf_pairs.get(event.source_product_id)
            # The readiness gate above guarantees this pairing exists.
            if pair is None:
                raise GoldBuildError(f"Missing TPF pair for {event.source_product_id}")
            tpf_row = self._tpf_row(event, pair[1])
            tpf_rows.append(tpf_row)
            lightcurve_event, _, _ = pair
            if lightcurve_event.source_product_id in evidence_by_lightcurve:
                raise GoldBuildError(
                    "Research-ready Gold requires one unambiguous TARGET_PIXEL "
                    f"input per light curve: {lightcurve_event.source_product_id}"
                )
            evidence_by_lightcurve[lightcurve_event.source_product_id] = (
                self._candidate_tpf_evidence(tpf_row)
            )

        candidate_rows: List[Dict[str, Any]] = []
        for event in lc_events:
            features = lc_features_by_source[event.source_product_id]
            candidate_row = self._candidate_row_from_features(event, features, catalogs)
            evidence = evidence_by_lightcurve.get(event.source_product_id)
            if evidence is None:
                raise GoldBuildError(
                    f"Research-ready Gold is missing materialized TPF evidence for {event.source_product_id}"
                )
            for schema_field in get_candidate_arrow_schema().names:
                if schema_field in evidence:
                    candidate_row[schema_field] = evidence[schema_field]
            candidate_rows.append(candidate_row)

        # Keep the result deterministic even when multiple TPFs pair to one LC.
        candidate_rows.sort(key=lambda row: str(row.get("source_product_id", "")))

        artifact_records: List[Dict[str, Any]] = []
        with tempfile.TemporaryDirectory(prefix="aurora-gold-") as temp_dir:
            artifact_records.extend(
                self._write_dataset(
                    plan,
                    bucket,
                    "candidate",
                    get_candidate_arrow_schema(),
                    candidate_rows,
                    temp_dir,
                )
            )

        dataset_row_counts = {
            dataset: sum(
                int(record["row_count"])
                for record in artifact_records
                if record["dataset"] == dataset
            )
            for dataset in ("candidate",)
            if any(record["dataset"] == dataset for record in artifact_records)
        }
        snapshot_row_count = dataset_row_counts.get("candidate") or sum(
            dataset_row_counts.values()
        )
        manifest_key = f"gold/snapshots/{plan.snapshot_id}/manifest.json"
        manifest_payload = plan.manifest.to_dict()
        manifest_payload.update(
            {
                "status": "COMMITTED",
                "row_count": snapshot_row_count,
                "dataset_row_counts": dataset_row_counts,
                "datasets": sorted({record["dataset"] for record in artifact_records}),
                "artifacts": artifact_records,
                "manifest_key": manifest_key,
                "completeness_contract": {
                    "policy": RESEARCH_READY_POLICY,
                    "required_product_kinds": [
                        "LIGHT_CURVE",
                        "TARGET_PIXEL",
                    ],
                    "required_catalogs": ["TIC", "TOI"],
                },
            }
        )
        manifest_bytes = json.dumps(
            manifest_payload, sort_keys=True, separators=(",", ":")
        ).encode("utf-8")
        manifest_sha = self._put_immutable(
            bucket, manifest_key, manifest_bytes, "application/json"
        )

        if set_current:
            pointer = {
                "snapshot_id": plan.snapshot_id,
                "snapshot_fingerprint": plan.snapshot_fingerprint,
                "manifest_key": manifest_key,
                "manifest_sha256": manifest_sha,
            }
            if candidate_rows:
                self.store.put_json(bucket, "gold/current/CANDIDATE.json", pointer)
        return GoldBuildResult(
            snapshot_id=plan.snapshot_id,
            snapshot_fingerprint=plan.snapshot_fingerprint,
            manifest_key=manifest_key,
            manifest_sha256=manifest_sha,
            row_count=snapshot_row_count,
            artifact_count=len(artifact_records),
            set_current=set_current,
            dataset_row_counts=dataset_row_counts,
        )

    def _candidate_row_from_features(
        self, event: SilverEvent, features: Any, catalogs: CatalogBundle
    ) -> Dict[str, Any]:
        row = _default_candidate_row()
        feature_dict = features.to_dict()
        for key in get_candidate_arrow_schema().names:
            if key in feature_dict and feature_dict[key] is not None:
                row[key] = feature_dict[key]
        row.update(
            {
                "source_product_id": event.source_product_id,
                "lineage_id": event.lineage_id,
                "sample_id": event.effective_sample_id,
                "tic_id": event.tic_id,
                "sector": int(event.sector),
                "silver_sha256": event.sha256,
                "lc_feature_version": features.feature_version,
                "lc_feature_fingerprint": features.feature_fingerprint,
            }
        )
        if not catalogs.snapshot_ids:
            row.update(
                {
                    "toi_match_status": "CATALOG_UNAVAILABLE",
                }
            )
            return row

        enrichment, _ = enrich_candidate(
            features,
            None,
            catalogs.tic_index,
            catalogs.toi_records,
            [],
            tic_snapshot_id=catalogs.snapshot_ids.get("TIC"),
            toi_snapshot_id=catalogs.snapshot_ids.get("TOI"),
            tce_snapshot_id=None,
        )
        row.update(
            {
                "ra_deg": catalogs.tic_index.get(event.tic_id).ra_deg
                if event.tic_id in catalogs.tic_index
                else None,
                "dec_deg": catalogs.tic_index.get(event.tic_id).dec_deg
                if event.tic_id in catalogs.tic_index
                else None,
                "tic_available": enrichment.tic_available,
                "tmag": enrichment.tmag,
                "teff": enrichment.teff,
                "stellar_radius": enrichment.stellar_radius,
                "stellar_mass": enrichment.stellar_mass,
                "logg": enrichment.logg,
                "matched_toi_id": enrichment.matched_toi_id,
                "toi_match_status": enrichment.toi_match_status,
                "toi_period_error": enrichment.toi_period_error,
            }
        )
        # A missing selected snapshot is operationally different from an empty
        # but valid catalog: make the absence visible rather than calling it a
        # scientific NO_MATCH.
        if not catalogs.has("TOI"):
            row.update(
                {
                    "matched_toi_id": None,
                    "toi_match_status": "CATALOG_UNAVAILABLE",
                    "toi_period_error": None,
                }
            )
        return row

    def save_pending(self, event: SilverEvent) -> None:
        key = f"checkpoints/gold-builder/pending/{event.event_id}.json"
        self.store.put_json(event.bucket or self.default_bucket, key, event.to_dict())

    def recover_pending_from_lineage(
        self, bucket: str | None = None
    ) -> list[tuple[str, SilverEvent]]:
        """Seed the durable Gold queue from committed Silver lineage.

        JetStream events are sufficient for newly-produced Silver, but they do
        not describe artifacts that existed before the Gold Builder was first
        deployed.  Lineage is the durable, checksum-verified source of truth
        for those artifacts.  This method intentionally never invents a
        Silver event from an object key alone.
        """
        bucket = bucket or self.default_bucket
        lineage_keys = [
            key
            for key in self.store.list_keys(bucket, "lineage/v1/tess/")
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
            pending_key = f"checkpoints/gold-builder/pending/{event.event_id}.json"
            recovered.append((pending_key, event))
            pending_keys.add(event.object_key)
        return recovered

    def _extracted_silver_keys(self, bucket: str) -> set[str]:
        """Return inputs from committed research-ready Gold manifests only.

        Earlier versions could write LC-only Gold. Those immutable snapshots
        remain auditable, but must not suppress recovery into the stricter
        multimodal builder after an upgrade.
        """
        keys: set[str] = set()
        for manifest_key in self.store.list_keys(bucket, "gold/snapshots/"):
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

    def pending_events(
        self, bucket: str | None = None
    ) -> list[tuple[str, SilverEvent]]:
        bucket = bucket or self.default_bucket
        events: list[tuple[str, SilverEvent]] = []
        prefix = "checkpoints/gold-builder/pending/"
        for key in self.store.list_keys(bucket, prefix):
            payload = self.store.get_json(bucket, key)
            if payload is not None:
                events.append((key, SilverEvent.from_dict(payload)))
        return events

    def pending_unextracted_events(
        self, bucket: str | None = None
    ) -> list[tuple[str, SilverEvent]]:
        """Return only work not already committed to research-ready Gold.

        A process can be interrupted after the immutable snapshot and
        ClickHouse projection succeed but before it removes a pending
        checkpoint.  On restart, discard those stale checkpoints instead of
        needlessly re-materializing the same Gold snapshot.
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

    def clear_pending(self, pending: Iterable[tuple[str, SilverEvent]]) -> None:
        for key, event in pending:
            # TPF contexts are reusable dependencies for later Gold
            # batches in the same sector; only LC queue entries are consumed.
            if key.startswith("checkpoints/gold-builder/pending/"):
                self.store.delete(event.bucket or self.default_bucket, key)
