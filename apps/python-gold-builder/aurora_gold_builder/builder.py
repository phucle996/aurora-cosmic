"""Silver-to-Gold materialization orchestration."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import io
import json
from pathlib import Path
import tempfile
from typing import Any, Dict, Iterable, List, Sequence

import numpy as np
import pyarrow.parquet as pq

from aurora_ml.pipeline.features import extract_features_from_silver
from aurora_ml.pipeline.gold import GoldSnapshotPlanner
from aurora_ml.pipeline.gold_materialize import (
    get_candidate_arrow_schema,
    write_partition_parquet,
)

from .events import SilverEvent
from .store import ObjectStore


class GoldBuildError(RuntimeError):
    """Raised when a Gold snapshot cannot be committed safely."""


@dataclass(frozen=True)
class GoldBuildResult:
    snapshot_id: str
    snapshot_fingerprint: str
    manifest_key: str
    manifest_sha256: str
    row_count: int
    artifact_count: int
    set_current: bool


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
    for field in get_candidate_arrow_schema():
        if str(field.type) == "bool":
            row[field.name] = False
        else:
            row[field.name] = None
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
    ):
        self.store = store
        self.default_bucket = default_bucket
        self.feature_version = feature_version
        self.bls_min_period_days = bls_min_period_days
        self.bls_max_period_days = bls_max_period_days
        self.bls_min_points = bls_min_points

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

    def _candidate_row(self, event: SilverEvent) -> Dict[str, Any]:
        if event.product_kind != "LIGHT_CURVE":
            raise GoldBuildError("Candidate Gold MVP accepts LIGHT_CURVE Silver inputs")
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
                "tic_id": event.tic_id
                if event.tic_id is not None
                else row.get("tic_id"),
                "sector": int(event.sector),
                "silver_sha256": event.sha256,
                "training_label": "UNRESOLVED",
                "label_policy_version": "candidate-label-policy-v1",
            }
        )
        row["lc_feature_version"] = features.feature_version
        row["lc_feature_fingerprint"] = features.feature_fingerprint
        return row

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

    def build_candidate(
        self,
        events: Iterable[SilverEvent],
        set_current: bool = False,
    ) -> GoldBuildResult:
        unique: Dict[str, SilverEvent] = {}
        for event in events:
            if event.product_kind != "LIGHT_CURVE":
                continue
            previous = unique.get(event.source_product_id)
            if previous is not None and previous.sha256 != event.sha256:
                raise GoldBuildError(
                    f"Conflicting Silver artifacts for {event.source_product_id}"
                )
            unique[event.source_product_id] = event
        selected = sorted(unique.values(), key=lambda event: event.source_product_id)
        if not selected:
            raise GoldBuildError(
                "No LIGHT_CURVE Silver events available for candidate Gold"
            )

        refs = [event.to_input_ref() for event in selected]
        plan = GoldSnapshotPlanner().plan_snapshot(
            snapshot_type="CANDIDATE",
            gold_schema_version="gold-candidate-v1",
            feature_versions={"lc": self.feature_version},
            inputs=refs,
        )
        rows = [self._candidate_row(event) for event in selected]
        rows_by_sector: Dict[int, List[Dict[str, Any]]] = {}
        for row in rows:
            rows_by_sector.setdefault(int(row["sector"]), []).append(row)

        artifact_records: List[Dict[str, Any]] = []
        with tempfile.TemporaryDirectory(prefix="aurora-gold-") as temp_dir:
            for sector, sector_rows in sorted(rows_by_sector.items()):
                local_path = Path(temp_dir) / f"candidate-{sector:04d}.parquet"
                row_count, content_sha, parquet_sha, size_bytes = (
                    write_partition_parquet(
                        schema=get_candidate_arrow_schema(),
                        rows=sector_rows,
                        dest_path=str(local_path),
                        dataset_name="candidate",
                        sector=sector,
                    )
                )
                artifact_key = (
                    f"gold/snapshots/{plan.snapshot_id}/data/candidate/"
                    f"sector={sector:04d}/part-00000.parquet"
                )
                artifact_bytes = local_path.read_bytes()
                if _sha256(artifact_bytes) != parquet_sha:
                    raise GoldBuildError(
                        f"Local Gold artifact hash changed for sector {sector}"
                    )
                self._put_immutable(
                    selected[0].bucket or self.default_bucket,
                    artifact_key,
                    artifact_bytes,
                    "application/vnd.apache.parquet",
                )
                artifact_records.append(
                    {
                        "dataset": "candidate",
                        "sector": sector,
                        "object_key": artifact_key,
                        "row_count": row_count,
                        "content_sha256": content_sha,
                        "parquet_sha256": parquet_sha,
                        "size_bytes": size_bytes,
                    }
                )

        manifest_key = f"gold/snapshots/{plan.snapshot_id}/manifest.json"
        manifest_payload = plan.manifest.to_dict()
        manifest_payload.update(
            {
                "status": "COMMITTED",
                "row_count": len(rows),
                "artifacts": artifact_records,
                "manifest_key": manifest_key,
            }
        )
        manifest_bytes = json.dumps(
            manifest_payload, sort_keys=True, separators=(",", ":")
        ).encode("utf-8")
        bucket = selected[0].bucket or self.default_bucket
        manifest_sha = self._put_immutable(
            bucket, manifest_key, manifest_bytes, "application/json"
        )

        if set_current:
            self.store.put_json(
                bucket,
                "gold/current/CANDIDATE.json",
                {
                    "snapshot_id": plan.snapshot_id,
                    "snapshot_fingerprint": plan.snapshot_fingerprint,
                    "manifest_key": manifest_key,
                    "manifest_sha256": manifest_sha,
                },
            )

        return GoldBuildResult(
            snapshot_id=plan.snapshot_id,
            snapshot_fingerprint=plan.snapshot_fingerprint,
            manifest_key=manifest_key,
            manifest_sha256=manifest_sha,
            row_count=len(rows),
            artifact_count=len(artifact_records),
            set_current=set_current,
        )

    def save_pending(self, event: SilverEvent) -> None:
        key = f"checkpoints/gold-builder/pending/{event.event_id}.json"
        self.store.put_json(event.bucket or self.default_bucket, key, event.to_dict())

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

    def clear_pending(self, pending: Iterable[tuple[str, SilverEvent]]) -> None:
        for key, event in pending:
            self.store.delete(event.bucket or self.default_bucket, key)
