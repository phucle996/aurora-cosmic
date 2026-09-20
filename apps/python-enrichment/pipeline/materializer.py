"""Silver-to-Gold materialization orchestration."""

from __future__ import annotations

from dataclasses import dataclass, field, replace
import hashlib
import io
import json
from pathlib import Path
import tempfile
import time
from typing import Any, Dict, Iterable, List, Sequence

import numpy as np
import pyarrow.parquet as pq

from pipeline.features import extract_features_from_silver
from pipeline.catalog_records import enrich_candidate
from pipeline.gold import GoldSnapshotPlanner
from pipeline.gold_materialize import (
    get_candidate_arrow_schema,
    write_partition_parquet,
)

from events import SilverEvent
from storage.checkpoints import EnrichmentCheckpointStore
from storage.object_store import ObjectStore
from .catalogs import CatalogBundle
from .tpf_features import TpfFeatureError, extract_tpf_row


class EnrichmentBuildError(RuntimeError):
    """Raised when an Enrichment snapshot cannot be committed safely."""


RESEARCH_READY_POLICY = "research-ready-target-pair-v4"
CATALOG_ENRICHMENT_VERSION = "catalog-enrichment-v4"
TPF_FEATURE_VERSION = "tpf-vetting-v2"
GOLD_SCHEMA_VERSION = "gold-candidate-v4"


@dataclass(frozen=True)
class EnrichmentBuildResult:
    snapshot_id: str
    snapshot_fingerprint: str
    manifest_key: str
    manifest_sha256: str
    row_count: int
    artifact_count: int
    set_current: bool
    dataset_row_counts: Dict[str, int] = field(default_factory=dict)
    lightcurve_inputs: int = 0
    target_pixel_inputs: int = 0
    lightcurve_feature_rows: int = 0
    bls_evidence_rows: int = 0
    target_pixel_evidence_rows: int = 0
    catalog_enriched_rows: int = 0
    lc_feature_duration_seconds: float = 0.0
    tpf_duration_seconds: float = 0.0
    assembly_duration_seconds: float = 0.0
    parquet_duration_seconds: float = 0.0
    parquet_bytes: int = 0



def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _column_values(table, name: str) -> list[Any]:
    if name not in table.column_names:
        raise EnrichmentBuildError(f"Silver Parquet is missing required column '{name}'")
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


class EnrichmentBuilder:
    """Build immutable candidate Enrichment/Gold snapshots from verified Silver artifacts."""

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
        self.checkpoint_store = EnrichmentCheckpointStore(store, default_bucket)
        self._observed_lineage_keys = self.checkpoint_store._observed_lineage_keys

    def _read_silver_table(self, event: SilverEvent):
        bucket = event.bucket or self.default_bucket
        data = self.store.get_bytes(bucket, event.object_key)
        actual_sha = _sha256(data)
        if actual_sha != event.sha256:
            raise EnrichmentBuildError(
                f"Silver checksum mismatch for {event.object_key}: "
                f"expected {event.sha256}, got {actual_sha}"
            )
        try:
            return pq.read_table(io.BytesIO(data))
        except Exception as exc:
            raise EnrichmentBuildError(
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
            raise EnrichmentBuildError(
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
            raise EnrichmentBuildError(str(exc)) from exc

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
                raise EnrichmentBuildError(
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
                raise EnrichmentBuildError(
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
        precomputed_lc_features: dict[str, Any] | None = None,
        precomputed_tpf_rows: dict[str, Any] | None = None,
    ) -> EnrichmentBuildResult:
        """Build one candidate snapshot from complete LC + TPF Silver pairs."""
        unique: Dict[str, SilverEvent] = {}
        for event in events:
            unique_key = f"{event.product_kind}:{event.source_product_id}"
            previous = unique.get(unique_key)
            if previous is not None and previous.sha256 != event.sha256:
                raise EnrichmentBuildError(
                    f"Conflicting Silver artifacts for {event.source_product_id}"
                )
            unique[unique_key] = event
        selected = sorted(unique.values(), key=lambda event: event.source_product_id)
        if not selected:
            raise EnrichmentBuildError("No Silver events available for Gold")
        bucket = selected[0].bucket or self.default_bucket
        # A Gold snapshot is valid only with the exact verified TIC/TOI bundle
        # selected for its batch.  Do not fall back to a mutable/global pointer:
        # that would make retries and ML provenance non-reproducible.
        if catalogs is None:
            raise EnrichmentBuildError(
                "Research-ready Gold requires verified batch-scoped catalog snapshots"
            )

        lc_events = [e for e in selected if e.product_kind == "LIGHT_CURVE"]
        tpf_events = [e for e in selected if e.product_kind == "TARGET_PIXEL"]
        if not lc_events:
            raise EnrichmentBuildError(
                "Research-ready Gold requires at least one LIGHT_CURVE"
            )
        missing_catalogs = [kind for kind in ("TIC", "TOI") if not catalogs.has(kind)]
        if missing_catalogs:
            raise EnrichmentBuildError(
                "Research-ready Gold requires verified immutable catalog snapshots: "
                + ", ".join(missing_catalogs)
            )
        lc_start = time.perf_counter()
        if precomputed_lc_features is not None:
            lc_features_by_source = dict(precomputed_lc_features)
            for event in lc_events:
                if event.source_product_id not in lc_features_by_source:
                    lc_features_by_source[event.source_product_id] = (
                        self._lightcurve_features(event)
                    )
        else:
            lc_features_by_source = {
                event.source_product_id: self._lightcurve_features(event)
                for event in lc_events
            }
        lc_duration = time.perf_counter() - lc_start

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
                raise EnrichmentBuildError(
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
            raise EnrichmentBuildError(
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
            producer="python-enrichment",
        )

        tpf_start = time.perf_counter()
        tpf_rows: List[Dict[str, Any]] = []
        evidence_by_lightcurve: Dict[str, Dict[str, Any]] = {}
        for event in tpf_events:
            pair = tpf_pairs.get(event.source_product_id)
            # The readiness gate above guarantees this pairing exists.
            if pair is None:
                raise EnrichmentBuildError(f"Missing TPF pair for {event.source_product_id}")
            if (
                precomputed_tpf_rows is not None
                and event.source_product_id in precomputed_tpf_rows
            ):
                tpf_row = precomputed_tpf_rows[event.source_product_id]
            else:
                tpf_row = self._tpf_row(event, pair[1])
            tpf_rows.append(tpf_row)
            lightcurve_event, _, _ = pair
            if lightcurve_event.source_product_id in evidence_by_lightcurve:
                raise EnrichmentBuildError(
                    "Research-ready Gold requires one unambiguous TARGET_PIXEL "
                    f"input per light curve: {lightcurve_event.source_product_id}"
                )
            evidence_by_lightcurve[lightcurve_event.source_product_id] = (
                self._candidate_tpf_evidence(tpf_row)
            )
        tpf_duration = time.perf_counter() - tpf_start

        assembly_start = time.perf_counter()
        candidate_rows: List[Dict[str, Any]] = []
        for event in lc_events:
            features = lc_features_by_source[event.source_product_id]
            candidate_row = self._candidate_row_from_features(event, features, catalogs)
            evidence = evidence_by_lightcurve.get(event.source_product_id)
            if evidence is None:
                raise EnrichmentBuildError(
                    f"Research-ready Gold is missing materialized TPF evidence for {event.source_product_id}"
                )
            for schema_field in get_candidate_arrow_schema().names:
                if schema_field in evidence:
                    candidate_row[schema_field] = evidence[schema_field]
            candidate_rows.append(candidate_row)

        # Keep the result deterministic even when multiple TPFs pair to one LC.
        candidate_rows.sort(key=lambda row: str(row.get("source_product_id", "")))
        assembly_duration = time.perf_counter() - assembly_start

        parquet_start = time.perf_counter()
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
        parquet_duration = time.perf_counter() - parquet_start
        parquet_bytes = sum(int(record.get("size_bytes") or 0) for record in artifact_records)

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
        return EnrichmentBuildResult(
            snapshot_id=plan.snapshot_id,
            snapshot_fingerprint=plan.snapshot_fingerprint,
            manifest_key=manifest_key,
            manifest_sha256=manifest_sha,
            row_count=snapshot_row_count,
            artifact_count=len(artifact_records),
            set_current=set_current,
            dataset_row_counts=dataset_row_counts,
            lightcurve_inputs=len(lc_events),
            target_pixel_inputs=len(tpf_events),
            lightcurve_feature_rows=len(lc_features_by_source),
            bls_evidence_rows=sum(
                bool(features.bls_available)
                for features in lc_features_by_source.values()
            ),
            target_pixel_evidence_rows=len(tpf_rows),
            catalog_enriched_rows=sum(
                bool(row.get("tic_available")) for row in candidate_rows
            ),
            lc_feature_duration_seconds=lc_duration,
            tpf_duration_seconds=tpf_duration,
            assembly_duration_seconds=assembly_duration,
            parquet_duration_seconds=parquet_duration,
            parquet_bytes=parquet_bytes,
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
        self.checkpoint_store.save_pending(event)

    def recover_pending_from_lineage(
        self, bucket: str | None = None
    ) -> list[tuple[str, SilverEvent]]:
        return self.checkpoint_store.recover_pending_from_lineage(bucket)

    def _extracted_silver_keys(self, bucket: str) -> set[str]:
        return self.checkpoint_store._extracted_silver_keys(bucket)

    @staticmethod
    def _silver_event_from_lineage(
        lineage: Dict[str, Any] | None,
    ) -> SilverEvent | None:
        return EnrichmentCheckpointStore._silver_event_from_lineage(lineage)

    def pending_events(
        self, bucket: str | None = None
    ) -> list[tuple[str, SilverEvent]]:
        return self.checkpoint_store.pending_events(bucket)

    def pending_unextracted_events(
        self, bucket: str | None = None
    ) -> list[tuple[str, SilverEvent]]:
        return self.checkpoint_store.pending_unextracted_events(bucket)

    def clear_pending(self, pending: Iterable[tuple[str, SilverEvent]]) -> None:
        self.checkpoint_store.clear_pending(pending)


