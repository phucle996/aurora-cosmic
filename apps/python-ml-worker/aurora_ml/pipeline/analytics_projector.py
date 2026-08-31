"""Durable MinIO-to-ClickHouse projection for Gold and inference outputs."""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import io
import json
import logging
from typing import Any

import clickhouse_connect
import pyarrow as pa
import pyarrow.parquet as pq

from aurora_ml.config import Config
from aurora_ml.infrastructure.object_store import MinioObjectStore

LOGGER = logging.getLogger("aurora-analytics-projector")


def _sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


class AnalyticsProjector:
    """Owns the rebuildable ClickHouse index derived from immutable MinIO data."""

    def __init__(self, config: Config):
        self.config = config
        self.bucket = config.minio_bucket
        self.objects = MinioObjectStore(config).client
        self.clickhouse = clickhouse_connect.get_client(
            host=config.clickhouse_host,
            port=config.clickhouse_port,
            username=config.clickhouse_user,
            password=config.clickhouse_password,
            database=config.clickhouse_database,
        )

    def _read(self, key: str) -> bytes:
        response = self.objects.get_object(self.bucket, key)
        try:
            return response.read()
        finally:
            response.close()
            response.release_conn()

    def _ready(self, snapshot_id: str, manifest_sha: str) -> bool:
        rows = self.clickhouse.query(
            "SELECT count() FROM gold_snapshots_v1 "
            "WHERE snapshot_id = {snapshot:String} AND manifest_sha256 = {sha:String} "
            "AND index_status = 'READY'",
            parameters={"snapshot": snapshot_id, "sha": manifest_sha},
        ).result_rows
        return bool(rows and rows[0][0])

    def project_snapshot(self, snapshot_id: str, rebuild: bool = False) -> int:
        manifest_key = f"gold/snapshots/{snapshot_id}/manifest.json"
        manifest_bytes = self._read(manifest_key)
        manifest_sha = _sha256(manifest_bytes)
        manifest = json.loads(manifest_bytes)
        if manifest.get("status") != "COMMITTED":
            raise ValueError(f"Gold snapshot {snapshot_id} is not committed")
        if self._ready(snapshot_id, manifest_sha) and not rebuild:
            return 0

        self.clickhouse.command(
            "ALTER TABLE candidate_features_v1 DELETE WHERE snapshot_id = "
            "{snapshot:String} SETTINGS mutations_sync = 1",
            parameters={"snapshot": snapshot_id},
        )
        indexed_rows = 0
        target_rows: dict[tuple[int, int], list[Any]] = {}
        for artifact in manifest.get("artifacts", []):
            if artifact.get("dataset") != "candidate":
                continue
            key = artifact.get("object_key") or artifact.get("artifact_key")
            if not key:
                continue
            content = self._read(str(key))
            expected_sha = artifact.get("parquet_sha256")
            if expected_sha and _sha256(content) != expected_sha:
                raise ValueError(f"Gold checksum mismatch for {key}")
            table = pq.read_table(io.BytesIO(content))
            if table.num_rows != int(artifact.get("row_count", -1)):
                raise ValueError(f"Gold row count mismatch for {key}")
            table = table.append_column(
                "snapshot_id",
                pa.array([snapshot_id] * table.num_rows, type=pa.string()),
            )
            self.clickhouse.insert_arrow("candidate_features_v1", table)
            indexed_rows += table.num_rows
            for row in table.to_pylist():
                tic_id = row.get("tic_id")
                sector = row.get("sector")
                if tic_id is None or sector is None:
                    continue
                target_rows[(int(tic_id), int(sector))] = [
                    int(tic_id),
                    float(row.get("tmag") or 0.0),
                    0.0,
                    0.0,
                    float(row.get("teff") or 0.0),
                    float(row.get("logg") or 0.0),
                    float(row.get("stellar_radius") or 0.0),
                    int(sector),
                    row.get("matched_toi_id"),
                    str(row.get("toi_match_status") or "UNRESOLVED"),
                ]
        if target_rows:
            self.clickhouse.insert(
                "targets",
                list(target_rows.values()),
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
                ],
            )
        self.clickhouse.insert(
            "gold_snapshots_v1",
            [
                [
                    snapshot_id,
                    str(manifest.get("snapshot_type", "CANDIDATE")),
                    str(manifest.get("snapshot_fingerprint", "")),
                    str(manifest.get("gold_schema_version", "")),
                    manifest_key,
                    manifest_sha,
                    int(manifest.get("row_count", indexed_rows)),
                    indexed_rows,
                    datetime.now(timezone.utc),
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
        return indexed_rows

    def _project_prediction(self, key: str) -> int:
        content = self._read(key)
        checkpoint_key = f"analytics/checkpoints/predictions/{_sha256(content)}.json"
        try:
            self._read(checkpoint_key)
            return 0
        except Exception:
            pass
        candidate_rows: list[list[Any]] = []
        anomaly_rows: list[list[Any]] = []
        for line in content.splitlines():
            record = json.loads(line)
            task_dir = (
                "candidate" if record.get("task") == "candidate_vetting" else "anomaly"
            )
            job = json.loads(
                self._read(
                    f"manifests/inference-jobs/{task_dir}/{record['job_id']}.json"
                )
            )
            model_version = str(job.get("model_version", "runtime-v1"))
            if record.get("task") == "candidate_vetting":
                candidate_rows.append(
                    [
                        record["prediction_id"],
                        record["source_product_id"],
                        int(record["tic_id"]),
                        int(record["sector"]),
                        float(record["raw_logit"]),
                        float(record["candidate_score"]),
                        float(record["decision_threshold"]),
                        bool(record["above_threshold"]),
                        model_version,
                        record["registered_model_id"],
                        record["gold_snapshot_id"],
                        record["runtime_validation_id"],
                        record["runtime_package_id"],
                        record["predicted_at"],
                    ]
                )
            elif record.get("task") == "astronomical_anomaly_detection":
                anomaly_rows.append(
                    [
                        record["prediction_id"],
                        record["source_product_id"],
                        int(record["tic_id"]),
                        int(record["sector"]),
                        float(record["reconstruction_mse"]),
                        float(record["decision_threshold"]),
                        bool(record["above_threshold"]),
                        model_version,
                        record["registered_model_id"],
                        record["gold_snapshot_id"],
                        record["runtime_validation_id"],
                        record["runtime_package_id"],
                        record["predicted_at"],
                    ]
                )
        if candidate_rows:
            self.clickhouse.insert(
                "candidate_predictions",
                candidate_rows,
                column_names=[
                    "prediction_id",
                    "source_product_id",
                    "tic_id",
                    "sector",
                    "raw_logit",
                    "candidate_score",
                    "decision_threshold",
                    "above_threshold",
                    "model_version",
                    "registered_model_id",
                    "gold_snapshot_id",
                    "runtime_validation_id",
                    "runtime_package_id",
                    "predicted_at",
                ],
            )
        if anomaly_rows:
            self.clickhouse.insert(
                "anomaly_predictions",
                anomaly_rows,
                column_names=[
                    "prediction_id",
                    "source_product_id",
                    "tic_id",
                    "sector",
                    "reconstruction_mse",
                    "decision_threshold",
                    "above_threshold",
                    "model_version",
                    "registered_model_id",
                    "gold_snapshot_id",
                    "runtime_validation_id",
                    "runtime_package_id",
                    "predicted_at",
                ],
            )
        checkpoint = json.dumps({"source_key": key}, sort_keys=True).encode()
        self.objects.put_object(
            self.bucket,
            checkpoint_key,
            io.BytesIO(checkpoint),
            len(checkpoint),
            content_type="application/json",
        )
        return len(candidate_rows) + len(anomaly_rows)

    def reconcile(self) -> tuple[int, int]:
        """Legacy full reconciliation kept for the explicit CLI command only."""
        gold_rows = 0
        manifests = sorted(
            item.object_name
            for item in self.objects.list_objects(
                self.bucket, prefix="gold/snapshots/", recursive=True
            )
            if item.object_name.endswith("/manifest.json")
        )
        for key in manifests:
            snapshot_id = key.split("/")[2]
            try:
                gold_rows += self.project_snapshot(snapshot_id)
            except Exception:
                LOGGER.exception("Failed to project Gold snapshot %s", snapshot_id)
        return gold_rows, self.reconcile_predictions()

    def reconcile_predictions(self) -> int:
        """Project inference outputs only; Gold is owned by Gold Builder."""
        prediction_rows = 0
        for item in self.objects.list_objects(
            self.bucket, prefix="predictions/", recursive=True
        ):
            if item.object_name.endswith(".jsonl"):
                try:
                    prediction_rows += self._project_prediction(item.object_name)
                except Exception:
                    LOGGER.exception(
                        "Failed to project predictions %s", item.object_name
                    )
        return prediction_rows
