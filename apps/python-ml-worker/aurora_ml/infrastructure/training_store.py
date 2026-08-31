"""Durable Gold/model/job storage for training orchestration."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import io
import json
from pathlib import Path
from typing import Any

import clickhouse_connect
import pyarrow.parquet as pq

from aurora_ml.domain.training import TASK_CANDIDATE
from aurora_ml.infrastructure.object_store import MinioObjectStore, ObjectStoreError
from aurora_ml.pipeline.gold import (
    GoldSnapshotManifest,
    SilverInputRef,
    sort_silver_inputs,
)


class TrainingDataError(RuntimeError):
    pass


@dataclass(frozen=True)
class LoadedGoldSnapshot:
    snapshot_id: str
    manifest: GoldSnapshotManifest
    raw_manifest: dict[str, Any]
    manifest_sha256: str
    rows: list[dict[str, Any]]


class TrainingStore:
    """Maps only committed, task-compatible Gold data to ML inputs."""

    def __init__(
        self, objects: MinioObjectStore, workspace: Path, config: Any | None = None
    ):
        self.objects = objects
        self.workspace = workspace
        self.config = config

    def _attach_curated_labels(
        self, snapshot_id: str, rows: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        """Join the mutable cohort overlay; Gold itself remains label-free."""
        if self.config is None:
            raise TrainingDataError("CURATED_COHORT_CONFIGURATION_MISSING")
        client = clickhouse_connect.get_client(
            host=self.config.clickhouse_host,
            port=self.config.clickhouse_port,
            username=self.config.clickhouse_user,
            password=self.config.clickhouse_password,
            database=self.config.clickhouse_database,
        )
        labels = client.query(
            "SELECT source_product_id, training_label FROM candidate_training_cohort_v1 FINAL "
            "WHERE snapshot_id = {snapshot:String} AND train_eligible = 1",
            parameters={"snapshot": snapshot_id},
        ).result_rows
        by_source = {str(source): str(label) for source, label in labels}
        return [
            {
                **row,
                "training_label": by_source.get(
                    str(row.get("source_product_id")), "UNRESOLVED"
                ),
            }
            for row in rows
        ]

    def _gold_rows(
        self, *, task: str, snapshot_id: str, raw_manifest: dict[str, Any]
    ) -> list[dict[str, Any]]:
        expected_dataset = "candidate" if task == TASK_CANDIDATE else "lightcurve"
        artifacts = raw_manifest.get("artifacts")
        if not isinstance(artifacts, list):
            raise TrainingDataError("GOLD_ARTIFACTS_MISSING")
        selected = [
            artifact
            for artifact in artifacts
            if isinstance(artifact, dict)
            and artifact.get("dataset") == expected_dataset
            and int(artifact.get("row_count", 0)) > 0
        ]
        if not selected:
            raise TrainingDataError(
                f"NO_{expected_dataset.upper()}_GOLD_ARTIFACTS: {snapshot_id}"
            )

        rows: list[dict[str, Any]] = []
        target_dir = self.workspace / "gold" / snapshot_id / expected_dataset
        for index, artifact in enumerate(selected):
            key = str(artifact.get("object_key", ""))
            expected_sha = str(artifact.get("parquet_sha256", ""))
            if not key or len(expected_sha) != 64:
                raise TrainingDataError(
                    f"INVALID_GOLD_ARTIFACT_CONTRACT: {snapshot_id}"
                )
            local = target_dir / f"{index:05d}.parquet"
            self.objects.download(key, local)
            actual_sha = hashlib.sha256(local.read_bytes()).hexdigest()
            if actual_sha != expected_sha:
                raise TrainingDataError(f"GOLD_ARTIFACT_SHA_MISMATCH: {key}")
            try:
                parquet = pq.ParquetFile(local)
                for batch in parquet.iter_batches(batch_size=4096):
                    rows.extend(batch.to_pylist())
            except Exception as exc:
                raise TrainingDataError(f"INVALID_GOLD_PARQUET: {key}") from exc
        if not rows:
            raise TrainingDataError(
                f"EMPTY_GOLD_DATASET: {snapshot_id}/{expected_dataset}"
            )
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
        try:
            manifest = GoldSnapshotManifest.from_dict(raw_manifest)
        except Exception as exc:
            raise TrainingDataError(
                f"INVALID_GOLD_MANIFEST_CONTRACT: {snapshot_id}"
            ) from exc
        return LoadedGoldSnapshot(
            snapshot_id=snapshot_id,
            manifest=manifest,
            raw_manifest=raw_manifest,
            manifest_sha256=hashlib.sha256(raw_bytes).hexdigest(),
            rows=(
                self._attach_curated_labels(
                    snapshot_id,
                    self._gold_rows(
                        task=task, snapshot_id=snapshot_id, raw_manifest=raw_manifest
                    ),
                )
                if task == TASK_CANDIDATE
                else self._gold_rows(
                    task=task, snapshot_id=snapshot_id, raw_manifest=raw_manifest
                )
            ),
        )

    def load_gold_snapshots(
        self, task: str, snapshot_ids: tuple[str, ...]
    ) -> LoadedGoldSnapshot:
        """Build one deterministic ML dataset from committed Gold snapshots.

        Source snapshots remain immutable. The returned manifest identifies the
        curated training view (including the current reviewed-label overlay),
        while ``raw_manifest`` retains every source manifest hash for audit.
        Repeated Gold rows are collapsed by source product so selecting
        overlapping snapshots cannot leak one observation across data splits.
        """
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
                or manifest.feature_versions != first.feature_versions
            ):
                raise TrainingDataError("INCOMPATIBLE_GOLD_SNAPSHOT_CONTRACTS")

        # Later committed snapshots win for the same immutable source product.
        chronological = sorted(
            loaded,
            key=lambda item: (
                str(item.raw_manifest.get("created_at", "")),
                item.snapshot_id,
            ),
        )
        rows_by_source: dict[str, dict[str, Any]] = {}
        anonymous_rows: dict[str, dict[str, Any]] = {}
        for item in chronological:
            for row in item.rows:
                source_id = str(row.get("source_product_id", "")).strip()
                if source_id:
                    rows_by_source[source_id] = row
                    continue
                encoded = json.dumps(
                    row, sort_keys=True, separators=(",", ":"), default=str
                )
                anonymous_rows[hashlib.sha256(encoded.encode()).hexdigest()] = row
        rows = [rows_by_source[key] for key in sorted(rows_by_source)]
        rows.extend(anonymous_rows[key] for key in sorted(anonymous_rows))

        inputs_by_key: dict[tuple[str, str, str], SilverInputRef] = {}
        for item in chronological:
            for source in item.manifest.inputs:
                inputs_by_key[
                    (
                        source.product_kind,
                        source.source_product_id,
                        source.processor_version,
                    )
                ] = source
        inputs = sort_silver_inputs(list(inputs_by_key.values()))

        source_contract = [
            {"snapshot_id": item.snapshot_id, "manifest_sha256": item.manifest_sha256}
            for item in loaded
        ]
        label_contract = [
            (str(row.get("source_product_id", "")), str(row.get("training_label", "")))
            for row in rows
        ]
        canonical = json.dumps(
            {
                "contract": "ml-curated-gold-set-v1",
                "sources": source_contract,
                "labels": label_contract,
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
        fingerprint = hashlib.sha256(canonical).hexdigest()
        curated_id = f"gold-v1-curated-{fingerprint[:12]}"
        created_at = max(
            str(item.raw_manifest.get("created_at", "")) for item in loaded
        )
        manifest = GoldSnapshotManifest(
            snapshot_id=curated_id,
            snapshot_fingerprint=fingerprint,
            snapshot_type=first.snapshot_type,
            gold_schema_version=first.gold_schema_version,
            feature_versions=dict(first.feature_versions),
            input_count=len(inputs),
            inputs=inputs,
            catalog_snapshots={
                "source_set_sha256": hashlib.sha256(
                    json.dumps(source_contract, sort_keys=True).encode()
                ).hexdigest()
            },
            label_snapshots={
                "candidate_training_cohort_sha256": hashlib.sha256(
                    json.dumps(label_contract).encode()
                ).hexdigest()
            },
            created_at=created_at,
            producer="python-ml-worker/curated-gold-set-v1",
        )
        manifest.validate()
        raw_manifest = {
            **manifest.to_dict(),
            "status": "CURATED",
            "source_gold_snapshots": source_contract,
            "row_count": len(rows),
        }
        return LoadedGoldSnapshot(
            snapshot_id=curated_id,
            manifest=manifest,
            raw_manifest=raw_manifest,
            manifest_sha256=hashlib.sha256(
                json.dumps(raw_manifest, sort_keys=True, separators=(",", ":")).encode()
            ).hexdigest(),
            rows=rows,
        )

    def read_job(self, job_id: str) -> dict[str, Any] | None:
        try:
            return self.objects.read_json(f"models/training-jobs/{job_id}.json")
        except ObjectStoreError:
            return None

    def write_job(self, job_id: str, record: dict[str, Any]) -> str:
        # Job state is intentionally mutable at one known key.  It is an
        # operational journal, while run/model/evaluation artifacts are immutable.
        data = json.dumps(record, sort_keys=True, separators=(",", ":")).encode()
        self.objects.client.put_object(
            self.objects.bucket,
            f"models/training-jobs/{job_id}.json",
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
        key = f"models/registry/{'candidate' if task == TASK_CANDIDATE else 'anomaly'}/{model_id}/model.pt"
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
