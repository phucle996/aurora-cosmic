"""Idempotent Gold-to-ClickHouse query-index projection.

MinIO Gold snapshots are canonical.  ClickHouse is a derived index owned by
the Gold Builder and can always be rebuilt from a committed manifest.
"""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import io
import json
import logging
import math
from typing import Any

import clickhouse_connect
import pyarrow as pa
import pyarrow.parquet as pq

from ..application.materializer import GoldBuildResult
from ..application.training_cohort import COHORT_POLICY_VERSION, label_rows
from ..config import Config
from .object_store import ObjectStore

LOGGER = logging.getLogger("aurora-gold-projector")


def _sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


class GoldClickHouseProjector:
    """Projects one committed Gold snapshot, exactly once per manifest hash."""

    def __init__(self, config: Config, store: ObjectStore):
        self.config = config
        self.store = store
        self.bucket = config.minio_bucket
        self.clickhouse = clickhouse_connect.get_client(
            host=config.clickhouse_host,
            port=config.clickhouse_port,
            username=config.clickhouse_user,
            password=config.clickhouse_password,
            database=config.clickhouse_database,
        )

    def _ready(self, snapshot_id: str, manifest_sha: str) -> bool:
        rows = self.clickhouse.query(
            "SELECT count() FROM gold_snapshots_v1 "
            "WHERE snapshot_id = {snapshot:String} AND manifest_sha256 = {sha:String} "
            "AND index_status = 'READY'",
            parameters={"snapshot": snapshot_id, "sha": manifest_sha},
        ).result_rows
        return bool(rows and rows[0][0])

    def _replace_targets(self, target_rows: dict[tuple[int, int], list[Any]]) -> None:
        """Replace target keys before insertion so retry never leaves duplicate rows."""
        by_sector: dict[int, list[int]] = {}
        for tic_id, sector in target_rows:
            by_sector.setdefault(sector, []).append(tic_id)
        for sector, tic_ids in by_sector.items():
            self.clickhouse.command(
                "ALTER TABLE targets DELETE WHERE sector = {sector:Int32} "
                "AND tic_id IN {tic_ids:Array(Int64)} SETTINGS mutations_sync = 1",
                parameters={"sector": sector, "tic_ids": sorted(set(tic_ids))},
            )
        projected_at = datetime.now(timezone.utc)
        self.clickhouse.insert(
            "targets",
            [row + [projected_at] for row in target_rows.values()],
            column_names=[
                "tic_id",
                "tess_mag",
                "ra",
                "dec",
                "effective_t",
                "surface_grav",
                "radius",
                "sector",
                "matched_toi",
                "disposition",
                "updated_at",
            ],
        )

    def _ensure_candidate_schema(self) -> None:
        """Keep the ClickHouse projection aligned with Candidate Gold v4."""
        # These fields used to duplicate immutable snapshot-level contract
        # evidence or expose a TCE/label workflow that this dataset does not
        # implement.  Drop them instead of writing a constant placeholder.
        for column in (
            "tpf_evidence_available",
            "matched_tce_id",
            "tce_match_status",
            "training_label",
            "label_policy_version",
            "tic_catalog_snapshot_id",
            "toi_catalog_snapshot_id",
            "tce_catalog_snapshot_id",
            "catalog_enrichment_status",
        ):
            self.clickhouse.command(
                f"ALTER TABLE candidate_features_v1 DROP COLUMN IF EXISTS {column}"
            )
        # Replace the legacy overlay view so stale derived rows cannot override
        # the complete canonical candidate row.
        self.clickhouse.command(
            "CREATE OR REPLACE VIEW candidate_features_current_v1 AS "
            "SELECT * FROM candidate_features_v1"
        )

    def _ensure_lightcurve_sample_schema(self) -> None:
        """Create the derived, replayable visualization index for LC samples.

        Gold features remain the canonical analytical product.  This table is
        only a checksum-verified ClickHouse acceleration index for plotting
        the exact Silver time/flux samples; it can be rebuilt at any time.
        """
        self.clickhouse.command(
            """CREATE TABLE IF NOT EXISTS lightcurve_samples_v1 (
                source_product_id String, silver_sha256 String,
                tic_id Int64, sector Int32, time Float64, flux Float64,
                projected_at DateTime64(3, 'UTC')
            ) ENGINE = ReplacingMergeTree(projected_at)
            PARTITION BY sector
            ORDER BY (sector, tic_id, source_product_id, silver_sha256, time)"""
        )

    def _ensure_training_cohort_schema(self) -> None:
        """Create the mutable review overlay beside immutable Candidate Gold."""
        self.clickhouse.command(
            """CREATE TABLE IF NOT EXISTS candidate_training_cohort_v1 (
                snapshot_id String, source_product_id String, tic_id Int64, sector Int32,
                training_label LowCardinality(String), confidence Float64,
                label_source LowCardinality(String), review_status LowCardinality(String),
                train_eligible UInt8, policy_version String, evidence_json String,
                review_reason String DEFAULT '',
                updated_at DateTime64(3, 'UTC')
            ) ENGINE = ReplacingMergeTree(updated_at)
            PARTITION BY snapshot_id
            ORDER BY (snapshot_id, source_product_id)"""
        )
        self.clickhouse.command(
            "ALTER TABLE candidate_training_cohort_v1 "
            "ADD COLUMN IF NOT EXISTS review_reason String DEFAULT ''"
        )

    def _project_training_cohort(self, snapshot_id: str, rows: list[dict[str, Any]]) -> dict[str, int]:
        labels = label_rows(snapshot_id, rows)
        self.clickhouse.command(
            "ALTER TABLE candidate_training_cohort_v1 DELETE WHERE snapshot_id = "
            "{snapshot:String} SETTINGS mutations_sync = 1",
            parameters={"snapshot": snapshot_id},
        )
        if labels:
            indexed_at = datetime.now(timezone.utc)
            for row in labels:
                row["updated_at"] = indexed_at
            columns = [
                "snapshot_id", "source_product_id", "tic_id", "sector",
                "training_label", "confidence", "label_source", "review_status",
                "train_eligible", "policy_version", "evidence_json", "updated_at",
            ]
            self.clickhouse.insert(
                "candidate_training_cohort_v1",
                [[row[column] for column in columns] for row in labels],
                column_names=columns,
            )
        counts = {"positive": 0, "negative": 0, "unresolved": 0}
        for row in labels:
            counts[row["training_label"].lower()] += 1
        return counts

    def backfill_training_cohort(self, snapshot_id: str) -> dict[str, int]:
        """Re-derive a cohort from an already indexed immutable Gold snapshot."""
        self._ensure_training_cohort_schema()
        result = self.clickhouse.query(
            "SELECT source_product_id, tic_id, sector, toi_match_status, "
            "transit_evidence_available, bls_available, bls_power "
            "FROM candidate_features_v1 WHERE snapshot_id = {snapshot:String}",
            parameters={"snapshot": snapshot_id},
        )
        names = result.column_names
        rows = [dict(zip(names, values)) for values in result.result_rows]
        return self._project_training_cohort(snapshot_id, rows)

    @staticmethod
    def _candidate_context_from_table(table: pa.Table) -> dict[str, tuple[int, int]]:
        contexts: dict[str, tuple[int, int]] = {}
        for row in table.to_pylist():
            source_product_id = str(row.get("source_product_id") or "")
            tic_id, sector = row.get("tic_id"), row.get("sector")
            if source_product_id and tic_id is not None and sector is not None:
                contexts[source_product_id] = (int(tic_id), int(sector))
        return contexts

    def _project_lightcurve_inputs(
        self,
        manifest: dict[str, Any],
        candidate_context: dict[str, tuple[int, int]],
    ) -> int:
        """Index exact LC samples for candidate inputs referenced by a manifest."""
        sample_count = 0
        projected_at = datetime.now(timezone.utc)
        for source in manifest.get("inputs", []):
            if source.get("product_kind") != "LIGHT_CURVE":
                continue
            source_product_id = str(source.get("source_product_id") or "")
            context = candidate_context.get(source_product_id)
            if context is None:
                continue
            object_key = str(source.get("silver_object_key") or "")
            bucket = str(source.get("silver_bucket") or self.bucket)
            expected_sha = str(source.get("silver_sha256") or "")
            content = self.store.get_bytes(bucket, object_key)
            if not expected_sha or _sha256(content) != expected_sha:
                raise ValueError(
                    f"Silver checksum mismatch for lightcurve {object_key}"
                )
            table = pq.read_table(io.BytesIO(content), columns=["time", "flux"])
            time_values = table.column("time").combine_chunks().to_pylist()
            flux_values = table.column("flux").combine_chunks().to_pylist()
            rows = [
                (float(time), float(flux))
                for time, flux in zip(time_values, flux_values)
                if time is not None
                and flux is not None
                and math.isfinite(float(time))
                and math.isfinite(float(flux))
            ]
            if not rows:
                continue
            tic_id, sector = context
            sample_table = pa.table(
                {
                    "source_product_id": pa.array([source_product_id] * len(rows)),
                    "silver_sha256": pa.array([expected_sha] * len(rows)),
                    "tic_id": pa.array([tic_id] * len(rows), type=pa.int64()),
                    "sector": pa.array([sector] * len(rows), type=pa.int32()),
                    "time": pa.array([row[0] for row in rows], type=pa.float64()),
                    "flux": pa.array([row[1] for row in rows], type=pa.float64()),
                    "projected_at": pa.array([projected_at] * len(rows)),
                }
            )
            self.clickhouse.insert_arrow("lightcurve_samples_v1", sample_table)
            sample_count += len(rows)
        return sample_count

    def backfill_lightcurves(
        self, snapshot_id: str | None = None, tic_id: int | None = None
    ) -> dict[str, int]:
        """Rebuild plot samples from committed immutable Gold manifests.

        The operation reads only the Silver artifacts referenced by each Gold
        manifest, verifies their digest, and is safe to rerun because the
        sample index uses a replacing key derived from that immutable source.
        """
        self._ensure_lightcurve_sample_schema()
        manifests = (
            [f"gold/snapshots/{snapshot_id}/manifest.json"]
            if snapshot_id
            else [
                key
                for key in self.store.list_keys(self.bucket, "gold/snapshots/")
                if key.endswith("/manifest.json")
            ]
        )
        stats = {"snapshots": 0, "sources": 0, "samples": 0}
        for manifest_key in sorted(manifests):
            manifest = self.store.get_json(self.bucket, manifest_key)
            if not manifest or manifest.get("status") != "COMMITTED":
                continue
            candidate_context: dict[str, tuple[int, int]] = {}
            for artifact in manifest.get("artifacts", []):
                if artifact.get("dataset") != "candidate":
                    continue
                artifact_table = pq.read_table(
                    io.BytesIO(
                        self.store.get_bytes(self.bucket, artifact["object_key"])
                    )
                )
                candidate_context.update(
                    self._candidate_context_from_table(artifact_table)
                )
            if tic_id is not None:
                candidate_context = {
                    source: context
                    for source, context in candidate_context.items()
                    if context[0] == tic_id
                }
            if not candidate_context:
                continue
            stats["snapshots"] += 1
            stats["sources"] += len(candidate_context)
            stats["samples"] += self._project_lightcurve_inputs(
                manifest, candidate_context
            )
        return stats

    def project(self, result: GoldBuildResult) -> int:
        """Index a result whose immutable manifest has already been committed."""
        self._ensure_candidate_schema()
        self._ensure_lightcurve_sample_schema()
        self._ensure_training_cohort_schema()
        manifest_bytes = self.store.get_bytes(self.bucket, result.manifest_key)
        manifest_sha = _sha256(manifest_bytes)
        if manifest_sha != result.manifest_sha256:
            raise ValueError(
                f"Gold manifest checksum mismatch for {result.manifest_key}"
            )
        manifest = json.loads(manifest_bytes)
        if manifest.get("status") != "COMMITTED":
            raise ValueError(f"Gold snapshot {result.snapshot_id} is not committed")
        if self._ready(result.snapshot_id, manifest_sha):
            self.backfill_training_cohort(result.snapshot_id)
            return 0

        self.clickhouse.command(
            "ALTER TABLE candidate_features_v1 DELETE WHERE snapshot_id = "
            "{snapshot:String} SETTINGS mutations_sync = 1",
            parameters={"snapshot": result.snapshot_id},
        )
        indexed_rows = 0
        target_rows: dict[tuple[int, int], list[Any]] = {}
        candidate_context: dict[str, tuple[int, int]] = {}
        candidate_rows: list[dict[str, Any]] = []
        for artifact in manifest.get("artifacts", []):
            dataset = artifact.get("dataset")
            if dataset != "candidate":
                continue
            object_key = artifact.get("object_key") or artifact.get("artifact_key")
            if not object_key:
                continue
            content = self.store.get_bytes(self.bucket, str(object_key))
            expected_sha = artifact.get("parquet_sha256")
            if expected_sha and _sha256(content) != expected_sha:
                raise ValueError(f"Gold checksum mismatch for {object_key}")
            table = pq.read_table(io.BytesIO(content))
            if table.num_rows != int(artifact.get("row_count", -1)):
                raise ValueError(f"Gold row count mismatch for {object_key}")
            table = table.append_column(
                "snapshot_id",
                pa.array([result.snapshot_id] * table.num_rows, type=pa.string()),
            )
            self.clickhouse.insert_arrow("candidate_features_v1", table)
            indexed_rows += table.num_rows
            candidate_context.update(self._candidate_context_from_table(table))
            for row in table.to_pylist():
                candidate_rows.append(row)
                tic_id, sector = row.get("tic_id"), row.get("sector")
                if tic_id is None or sector is None:
                    continue
                target_rows[(int(tic_id), int(sector))] = [
                    int(tic_id),
                    float(row.get("tmag") or 0.0),
                    float(row.get("ra_deg") or 0.0),
                    float(row.get("dec_deg") or 0.0),
                    float(row.get("teff") or 0.0),
                    float(row.get("logg") or 0.0),
                    float(row.get("stellar_radius") or 0.0),
                    int(sector),
                    row.get("matched_toi_id"),
                    str(row.get("toi_match_status") or "UNRESOLVED"),
                ]
        if target_rows:
            self._replace_targets(target_rows)
        cohort_counts = self._project_training_cohort(result.snapshot_id, candidate_rows)
        lightcurve_sample_count = self._project_lightcurve_inputs(
            manifest, candidate_context
        )

        indexed_at = datetime.now(timezone.utc)
        self.clickhouse.insert(
            "gold_snapshots_v1",
            [
                [
                    result.snapshot_id,
                    str(manifest.get("snapshot_type", "CANDIDATE")),
                    str(manifest.get("snapshot_fingerprint", "")),
                    str(manifest.get("gold_schema_version", "")),
                    result.manifest_key,
                    manifest_sha,
                    int(manifest.get("row_count", indexed_rows)),
                    indexed_rows,
                    indexed_at,
                    "READY",
                ]
            ],
            column_names=[
                "snapshot_id",
                "snapshot_type",
                "snapshot_fingerprint",
                "gold_schema_version",
                "manifest_key",
                "manifest_sha256",
                "expected_row_count",
                "indexed_row_count",
                "indexed_at",
                "index_status",
            ],
        )
        self.store.put_json(
            self.bucket,
            f"gold/snapshots/{result.snapshot_id}/projections/clickhouse-v1.json",
            {
                "snapshot_id": result.snapshot_id,
                "manifest_key": result.manifest_key,
                "manifest_sha256": manifest_sha,
                "indexed_row_count": indexed_rows,
                "lightcurve_sample_count": lightcurve_sample_count,
                "training_cohort_policy_version": COHORT_POLICY_VERSION,
                "training_cohort_counts": cohort_counts,
                "indexed_at": indexed_at.isoformat(),
                "status": "READY",
            },
        )
        LOGGER.info(
            "Indexed Gold snapshot %s rows=%d", result.snapshot_id, indexed_rows
        )
        return indexed_rows
