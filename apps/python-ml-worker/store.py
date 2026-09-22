"""MinIO Object Store and Training Data Store for ML Worker."""

from __future__ import annotations

from dataclasses import dataclass, field
import hashlib
import io
import json
from pathlib import Path
from typing import Any

import clickhouse_connect
from minio import Minio
import pyarrow.parquet as pq

from config import Config

TASK_CANDIDATE = "candidate_vetting"


class ObjectStoreError(RuntimeError):
    pass


class ImmutableObjectConflict(ObjectStoreError):
    pass


class TrainingDataError(RuntimeError):
    pass


class MinioObjectStore:
    def __init__(self, config: Config):
        endpoint = config.minio_endpoint.removeprefix("http://").removeprefix(
            "https://"
        )
        self.bucket = config.minio_bucket
        self.client = Minio(
            endpoint,
            access_key=config.minio_access_key,
            secret_key=config.minio_secret_key,
            secure=config.minio_secure,
        )

    @staticmethod
    def sha256(data: bytes) -> str:
        return hashlib.sha256(data).hexdigest()

    def read_bytes(self, key: str) -> bytes:
        response = self.client.get_object(self.bucket, key)
        try:
            return response.read()
        finally:
            response.close()
            response.release_conn()

    def read_json(self, key: str) -> dict[str, Any]:
        try:
            value = json.loads(self.read_bytes(key))
        except Exception as exc:
            raise ObjectStoreError(f"INVALID_JSON_OBJECT: {key}") from exc
        if not isinstance(value, dict):
            raise ObjectStoreError(f"JSON_OBJECT_EXPECTED: {key}")
        return value

    def put_immutable(self, key: str, data: bytes, content_type: str) -> str:
        digest = self.sha256(data)
        try:
            existing = self.read_bytes(key)
            if self.sha256(existing) != digest:
                raise ImmutableObjectConflict(f"IMMUTABLE_OBJECT_CONFLICT: {key}")
            return digest
        except Exception as exc:
            if isinstance(exc, ImmutableObjectConflict):
                raise
        self.client.put_object(
            self.bucket,
            key,
            io.BytesIO(data),
            len(data),
            content_type=content_type,
        )
        return digest

    def put_file_immutable(self, key: str, path: Path, content_type: str) -> str:
        data = path.read_bytes()
        return self.put_immutable(key, data, content_type)

    def download(self, key: str, destination: Path) -> str:
        destination.parent.mkdir(parents=True, exist_ok=True)
        data = self.read_bytes(key)
        destination.write_bytes(data)
        return self.sha256(data)


@dataclass(frozen=True)
class SnapshotManifest:
    snapshot_id: str
    manifest_sha256: str
    snapshot_fingerprint: str = ""
    snapshot_type: str = "CANDIDATE"
    gold_schema_version: str = "gold-candidate-v1"
    feature_versions: dict[str, str] = field(default_factory=dict)
    input_count: int = 0
    created_at: str = ""
    raw: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return self.raw or {
            "snapshot_id": self.snapshot_id,
            "manifest_sha256": self.manifest_sha256,
            "snapshot_fingerprint": self.snapshot_fingerprint,
            "snapshot_type": self.snapshot_type,
            "gold_schema_version": self.gold_schema_version,
            "feature_versions": self.feature_versions,
            "input_count": self.input_count,
            "created_at": self.created_at,
        }

    def validate(self) -> None:
        if not self.snapshot_id:
            raise ValueError("snapshot_id is required")
        if not self.manifest_sha256:
            raise ValueError("manifest_sha256 is required")

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "SnapshotManifest":
        return cls(
            snapshot_id=str(d.get("snapshot_id", "")),
            manifest_sha256=str(d.get("manifest_sha256", "")),
            snapshot_fingerprint=str(d.get("snapshot_fingerprint", "")),
            snapshot_type=str(d.get("snapshot_type", "CANDIDATE")),
            gold_schema_version=str(d.get("gold_schema_version", "gold-candidate-v1")),
            feature_versions=dict(d.get("feature_versions", {})),
            input_count=int(d.get("input_count", 0)),
            created_at=str(d.get("created_at", "")),
            raw=d,
        )


@dataclass(frozen=True)
class LoadedGoldSnapshot:
    snapshot_id: str
    manifest: SnapshotManifest
    raw_manifest: dict[str, Any]
    manifest_sha256: str
    rows: list[dict[str, Any]]


class TrainingStore:
    """Maps only committed Gold data to ML inputs."""

    def __init__(
        self, objects: MinioObjectStore, workspace: Path, config: Any | None = None
    ):
        self.objects = objects
        self.workspace = workspace
        self.config = config

    def _attach_curated_labels(
        self, snapshot_id: str, rows: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        """Join mutable cohort overlay from ClickHouse if configured."""
        if self.config is None:
            raise TrainingDataError("CURATED_COHORT_CONFIGURATION_MISSING")
        try:
            client = clickhouse_connect.get_client(
                host=self.config.clickhouse_host,
                port=self.config.clickhouse_port,
                username=self.config.clickhouse_user,
                password=self.config.clickhouse_password,
                database=self.config.clickhouse_database,
            )
            labels = client.query(
                """
                SELECT source_product_id, training_label, label_source, train_eligible
                FROM candidate_training_cohort_v1 FINAL
                WHERE snapshot_id = %(snapshot_id)s
                """,
                parameters={"snapshot_id": snapshot_id},
            ).result_rows
        except Exception:
            return rows

        overlay: dict[str, tuple[str, str]] = {}
        for r in labels:
            src_id = str(r[0]).strip()
            lbl = str(r[1]).strip().upper()
            src = str(r[2]).strip() if len(r) > 2 and r[2] else "COHORT"
            eligible = bool(r[3]) if len(r) > 3 else True
            if not eligible:
                continue
            if lbl in ("POSITIVE", "NEGATIVE", "EXCLUDED"):
                overlay[src_id] = (lbl, src)

        merged: list[dict[str, Any]] = []
        for row in rows:
            source_id = str(row.get("source_product_id", "")).strip()
            curated = dict(row)
            if source_id in overlay:
                curated["training_label"] = overlay[source_id][0]
                curated["training_label_source"] = overlay[source_id][1]
            merged.append(curated)
        return merged

    def _gold_rows(
        self, task: str, snapshot_id: str, raw_manifest: dict[str, Any]
    ) -> list[dict[str, Any]]:
        prefix = f"gold/snapshots/{snapshot_id}"
        partition_keys: list[str] = []
        for item in raw_manifest.get("artifacts", []):
            if isinstance(item, dict):
                obj_key = item.get("object_key") or item.get("key")
                if obj_key and str(obj_key).endswith(".parquet"):
                    partition_keys.append(str(obj_key))
        if not partition_keys:
            partition_keys = [
                f"{prefix}/{item['object_name']}"
                for item in raw_manifest.get("partitions", [])
                if isinstance(item, dict) and item.get("object_name")
            ]
        if not partition_keys:
            partition_keys = [f"{prefix}/data.parquet"]

        rows: list[dict[str, Any]] = []
        for key in partition_keys:
            try:
                data = self.objects.read_bytes(key)
                table = pq.read_table(io.BytesIO(data))
                rows.extend(table.to_pylist())
            except Exception as exc:
                raise TrainingDataError(f"UNREADABLE_GOLD_PARTITION: {key}") from exc
        return rows

    def load_gold_snapshot(self, task: str, snapshot_id: str) -> LoadedGoldSnapshot:
        key = f"gold/snapshots/{snapshot_id}/manifest.json"
        raw_bytes = self.objects.read_bytes(key)
        try:
            raw_manifest = json.loads(raw_bytes)
        except json.JSONDecodeError as exc:
            raise TrainingDataError(f"INVALID_GOLD_MANIFEST: {snapshot_id}") from exc
        if raw_manifest.get("status") != "COMMITTED":
            raise TrainingDataError(f"GOLD_NOT_COMMITTED: {snapshot_id}")
        if raw_manifest.get("snapshot_id") != snapshot_id:
            raise TrainingDataError(f"GOLD_SNAPSHOT_ID_MISMATCH: {snapshot_id}")

        manifest_sha = hashlib.sha256(raw_bytes).hexdigest()
        if "manifest_sha256" not in raw_manifest:
            raw_manifest["manifest_sha256"] = manifest_sha
        manifest = SnapshotManifest.from_dict(raw_manifest)
        rows = self._attach_curated_labels(
            snapshot_id,
            self._gold_rows(
                task=task, snapshot_id=snapshot_id, raw_manifest=raw_manifest
            ),
        )

        return LoadedGoldSnapshot(
            snapshot_id=snapshot_id,
            manifest=manifest,
            raw_manifest=raw_manifest,
            manifest_sha256=manifest_sha,
            rows=rows,
        )

    def load_gold_snapshots(
        self, task: str, snapshot_ids: tuple[str, ...]
    ) -> LoadedGoldSnapshot:
        ordered_ids = tuple(sorted(set(snapshot_ids)))
        if not ordered_ids:
            raise TrainingDataError("GOLD_SNAPSHOT_SELECTION_EMPTY")
        loaded = [self.load_gold_snapshot(task, value) for value in ordered_ids]
        if len(loaded) == 1:
            return loaded[0]

        first = loaded[0].manifest
        for item in loaded[1:]:
            manifest = item.manifest
            if (
                manifest.snapshot_type != first.snapshot_type
                or manifest.gold_schema_version != first.gold_schema_version
            ):
                raise TrainingDataError("INCOMPATIBLE_GOLD_SNAPSHOT_CONTRACTS")

        # Merge rows across snapshots
        rows_by_source: dict[str, dict[str, Any]] = {}
        for item in loaded:
            for row in item.rows:
                source_id = str(row.get("source_product_id", "")).strip()
                if source_id:
                    rows_by_source[source_id] = row
        rows = [rows_by_source[key] for key in sorted(rows_by_source)]

        combined_sha = hashlib.sha256(
            "".join(item.manifest_sha256 for item in loaded).encode()
        ).hexdigest()
        combined_id = f"gold-v1-curated-{combined_sha[:16]}"

        return LoadedGoldSnapshot(
            snapshot_id=combined_id,
            manifest=SnapshotManifest(
                snapshot_id=combined_id,
                manifest_sha256=combined_sha,
                snapshot_fingerprint=combined_sha[:16],
                snapshot_type=first.snapshot_type,
                gold_schema_version=first.gold_schema_version,
                input_count=len(rows),
                created_at=first.created_at,
            ),
            raw_manifest={
                "snapshot_id": combined_id,
                "status": "CURATED",
                "source_gold_snapshots": list(ordered_ids),
            },
            manifest_sha256=combined_sha,
            rows=rows,
        )

    def read_job(self, ticket_id: str) -> dict[str, Any] | None:
        try:
            return self.objects.read_json(f"models/training-jobs/{ticket_id}.json")
        except ObjectStoreError:
            return None

    def write_job(self, ticket_id: str, record: dict[str, Any]) -> str:
        data = json.dumps(record, sort_keys=True, separators=(",", ":")).encode()
        self.objects.client.put_object(
            self.objects.bucket,
            f"models/training-jobs/{ticket_id}.json",
            io.BytesIO(data),
            len(data),
            content_type="application/json",
        )
        return hashlib.sha256(data).hexdigest()

    def upload_tree(self, local_dir: Path, prefix: str) -> dict[str, str]:
        uploaded: dict[str, str] = {}
        for path in sorted(item for item in local_dir.rglob("*") if item.is_file()):
            relative = path.relative_to(local_dir).as_posix()
            content_type = (
                "application/json"
                if path.suffix == ".json"
                else "application/octet-stream"
            )
            uploaded[f"{prefix}/{relative}"] = self.objects.put_file_immutable(
                f"{prefix}/{relative}", path, content_type
            )
        return uploaded

    def download_model_weights(
        self, task: str, model_id: str, destination: Path
    ) -> bool:
        key = f"models/registry/candidate/{model_id}/model.pt"
        try:
            self.objects.download(key, destination)
        except Exception:
            return False
        return True

    def champion_model_id(self, task: str) -> str | None:
        try:
            pointer = self.objects.read_json(f"models/{task}/champion.json")
        except ObjectStoreError:
            return None
        model_id = str(pointer.get("model_id", "")).strip()
        return model_id or None
