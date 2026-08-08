"""Stage 5.6 Gold Analytical Projection & ClickHouse Query Index Loader.

Projects committed immutable MinIO Gold snapshots into rebuildable ClickHouse analytical tables.
Canonical scientific truth remains MinIO Gold Parquet + Gold manifest.json.
ClickHouse is strictly a derived query index.
"""

from dataclasses import dataclass
from datetime import datetime, timezone
import json
from typing import Any, Dict, List, Optional

from aurora_ml.pipeline.gold import GoldSnapshotManifest


class AnalyticsLoaderError(Exception):
    """Base exception for analytics query index failures."""

    pass


class UncommittedGoldError(AnalyticsLoaderError):
    """Raised when attempting to index an uncommitted or missing Gold snapshot."""

    pass


class GoldArtifactMissingError(AnalyticsLoaderError):
    """Raised when referenced Gold Parquet artifacts are missing or corrupt."""

    pass


class SnapshotIsolationError(AnalyticsLoaderError):
    """Raised when an analytical query fails to specify mandatory snapshot_id filter."""

    pass


@dataclass
class GoldSnapshotIndexRecord:
    """Record in aurora.gold_snapshots_v1 table."""

    snapshot_id: str
    snapshot_type: str
    snapshot_fingerprint: str
    gold_schema_version: str
    manifest_key: str
    manifest_sha256: str
    expected_row_count: int
    indexed_row_count: int
    index_status: str = "READY"
    indexed_at: str = ""


class GoldAnalyticsLoader:
    """Loader to project committed Gold datasets into ClickHouse derived tables."""

    def __init__(self, clickhouse_client=None):
        self.ch = clickhouse_client
        # In-memory derived store for offline / mock unit testing
        self.mock_snapshots: Dict[str, GoldSnapshotIndexRecord] = {}
        self.mock_candidate_rows: Dict[str, List[Dict[str, Any]]] = {}
        self.mock_anomaly_lc_rows: Dict[str, List[Dict[str, Any]]] = {}
        self.mock_anomaly_tpf_rows: Dict[str, List[Dict[str, Any]]] = {}
        self.mock_anomaly_ffi_rows: Dict[str, List[Dict[str, Any]]] = {}

    def is_snapshot_ready(self, snapshot_id: str) -> bool:
        """Check if snapshot is already indexed and READY."""
        if snapshot_id in self.mock_snapshots:
            return self.mock_snapshots[snapshot_id].index_status == "READY"
        return False

    def load_snapshot(
        self,
        manifest: GoldSnapshotManifest,
        rows_by_dataset: Dict[str, List[Dict[str, Any]]],
        manifest_sha256: str = "default_sha256",
        rebuild: bool = False,
    ) -> GoldSnapshotIndexRecord:
        """Load and project a committed Gold snapshot into analytical tables."""
        if not manifest or not manifest.snapshot_id:
            raise UncommittedGoldError("Cannot index snapshot: Manifest is missing or uncommitted")

        manifest.validate()
        sid = manifest.snapshot_id

        # Fast path if already READY and rebuild not requested
        if self.is_snapshot_ready(sid) and not rebuild:
            return self.mock_snapshots[sid]

        # Rebuild: clear existing derived partition for this snapshot_id
        if sid in self.mock_snapshots:
            del self.mock_snapshots[sid]
        self.mock_candidate_rows.pop(sid, None)
        self.mock_anomaly_lc_rows.pop(sid, None)
        self.mock_anomaly_tpf_rows.pop(sid, None)
        self.mock_anomaly_ffi_rows.pop(sid, None)

        total_indexed_rows = 0

        if manifest.snapshot_type.upper() == "CANDIDATE":
            cand_rows = rows_by_dataset.get("candidate", [])
            # Inject mandatory snapshot_id
            projected = []
            seen_product_ids = set()
            for r in cand_rows:
                pid = r.get("source_product_id")
                if pid in seen_product_ids:
                    raise AnalyticsLoaderError(f"Duplicate candidate identity in partition: '{pid}'")
                seen_product_ids.add(pid)
                r_copy = dict(r)
                r_copy["snapshot_id"] = sid
                projected.append(r_copy)
            self.mock_candidate_rows[sid] = projected
            total_indexed_rows += len(projected)

        elif manifest.snapshot_type.upper() == "ANOMALY":
            lc_rows = rows_by_dataset.get("lightcurve", [])
            tpf_rows = rows_by_dataset.get("tpf", [])
            ffi_rows = rows_by_dataset.get("ffi", [])

            if lc_rows:
                p_lc = [dict(r, snapshot_id=sid) for r in lc_rows]
                self.mock_anomaly_lc_rows[sid] = p_lc
                total_indexed_rows += len(p_lc)
            if tpf_rows:
                p_tpf = [dict(r, snapshot_id=sid) for r in tpf_rows]
                self.mock_anomaly_tpf_rows[sid] = p_tpf
                total_indexed_rows += len(p_tpf)
            if ffi_rows:
                p_ffi = [dict(r, snapshot_id=sid) for r in ffi_rows]
                self.mock_anomaly_ffi_rows[sid] = p_ffi
                total_indexed_rows += len(p_ffi)

        # Audit & verification against manifest expectations
        expected_count = manifest.input_count
        if total_indexed_rows != expected_count:
            # Drop derived rows if verification fails
            self.mock_candidate_rows.pop(sid, None)
            self.mock_anomaly_lc_rows.pop(sid, None)
            self.mock_anomaly_tpf_rows.pop(sid, None)
            self.mock_anomaly_ffi_rows.pop(sid, None)
            raise AnalyticsLoaderError(
                f"Row count audit mismatch for '{sid}': expected {expected_count}, got {total_indexed_rows}"
            )

        # Record READY status AFTER 100% verification
        rec = GoldSnapshotIndexRecord(
            snapshot_id=sid,
            snapshot_type=manifest.snapshot_type,
            snapshot_fingerprint=manifest.snapshot_fingerprint,
            gold_schema_version=manifest.gold_schema_version,
            manifest_key=f"gold/snapshots/{sid}/manifest.json",
            manifest_sha256=manifest_sha256,
            expected_row_count=expected_count,
            indexed_row_count=total_indexed_rows,
            index_status="READY",
            indexed_at=datetime.now(timezone.utc).isoformat(),
        )
        self.mock_snapshots[sid] = rec
        return rec

    def query_candidates(self, snapshot_id: str, sector: Optional[int] = None) -> List[Dict[str, Any]]:
        """Query candidate features filtering explicitly by snapshot_id."""
        if not snapshot_id:
            raise SnapshotIsolationError("Analytical queries MUST specify snapshot_id")
        rows = self.mock_candidate_rows.get(snapshot_id, [])
        if sector is not None:
            rows = [r for r in rows if r.get("sector") == sector]
        return rows
