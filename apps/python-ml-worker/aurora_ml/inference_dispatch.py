"""Durable MinIO-backed inference planning for the ML training workflow."""

from __future__ import annotations

from dataclasses import asdict
from datetime import datetime, timezone
import hashlib
import io
import json
from typing import Any

from minio import Minio

from aurora_ml.inference_jobs import (
    InferenceJobError,
    InferenceJobManifest,
    compute_job_fingerprint,
)


def _sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


class MinioInferenceJobPlanner:
    """Materialize immutable job manifests before publishing inference requests."""

    def __init__(self, client: Minio, bucket: str):
        self.client = client
        self.bucket = bucket

    def _read(self, key: str) -> bytes:
        response = self.client.get_object(self.bucket, key)
        try:
            return response.read()
        finally:
            response.close()
            response.release_conn()

    def _put_immutable(self, key: str, value: bytes) -> str:
        digest = _sha256(value)
        try:
            existing = self._read(key)
        except Exception:
            existing = None
        if existing is not None:
            if _sha256(existing) != digest:
                raise InferenceJobError(f"INFERENCE_JOB_CONFLICT: {key}")
            return digest
        self.client.put_object(
            self.bucket,
            key,
            io.BytesIO(value),
            len(value),
            content_type="application/json",
        )
        return digest

    def plan(
        self,
        *,
        task: str,
        gold_snapshot_ids: list[str],
        runtime_package_id: str,
        runtime_manifest_key: str,
    ) -> list[dict[str, Any]]:
        runtime_bytes = self._read(runtime_manifest_key)
        runtime_sha = _sha256(runtime_bytes)
        runtime = json.loads(runtime_bytes)
        if runtime.get("runtime_package_id") != runtime_package_id:
            raise InferenceJobError("runtime manifest does not match runtime package")
        if runtime.get("task") != task:
            raise InferenceJobError(
                "runtime manifest task does not match training task"
            )

        runtime_fingerprint = str(runtime.get("runtime_fingerprint", ""))
        if len(runtime_fingerprint) < 12:
            raise InferenceJobError("runtime manifest fingerprint is invalid")
        validation_id = f"rval-v1-{runtime_fingerprint[:12]}"
        # This is an evidence request, not a PASS assertion. Rust validates
        # the package before scoring and commits the record under this ID.

        if task != "candidate_vetting":
            raise InferenceJobError(f"unsupported retired inference task: {task}")
        requests: list[dict[str, Any]] = []
        task_dir = "candidate"
        expected_dataset = "candidate"
        selection_policy = "candidate-inference-selection-v1"
        for snapshot_id in gold_snapshot_ids:
            gold_manifest_key = f"gold/snapshots/{snapshot_id}/manifest.json"
            gold_manifest_bytes = self._read(gold_manifest_key)
            gold_manifest_sha = _sha256(gold_manifest_bytes)
            gold_manifest = json.loads(gold_manifest_bytes)
            if gold_manifest.get("status") != "COMMITTED":
                raise InferenceJobError(f"Gold snapshot {snapshot_id} is not committed")

            for artifact in gold_manifest.get("artifacts", []):
                if artifact.get("dataset") != expected_dataset:
                    continue
                row_count = int(artifact.get("row_count", 0))
                artifact_key = str(
                    artifact.get("object_key")
                    or artifact.get("artifact_key")
                    or artifact.get("path")
                    or ""
                )
                # Rust verifies actual Parquet bytes, not the logical row digest.
                artifact_sha = str(
                    artifact.get("parquet_sha256")
                    or artifact.get("content_sha256")
                    or artifact.get("sha256")
                    or ""
                )
                if row_count < 1 or not artifact_key or len(artifact_sha) != 64:
                    continue
                sector = int(artifact.get("sector", 1))
                job_id, fingerprint = compute_job_fingerprint(
                    task=task,
                    selection_policy_version=selection_policy,
                    gold_snapshot_id=snapshot_id,
                    gold_manifest_sha256=gold_manifest_sha,
                    gold_artifact_key=artifact_key,
                    gold_artifact_content_sha256=artifact_sha,
                    runtime_package_id=runtime_package_id,
                    runtime_manifest_sha256=runtime_sha,
                    runtime_validation_id=validation_id,
                )
                job = InferenceJobManifest(
                    schema_version=1,
                    job_id=job_id,
                    job_fingerprint=fingerprint,
                    task=task,
                    selection_policy_version=selection_policy,
                    gold_snapshot_id=snapshot_id,
                    gold_manifest_key=gold_manifest_key,
                    gold_manifest_sha256=gold_manifest_sha,
                    gold_dataset=str(artifact.get("dataset", "candidate")),
                    gold_schema_version=str(
                        gold_manifest.get("gold_schema_version", "")
                    ),
                    gold_artifact_key=artifact_key,
                    gold_artifact_content_sha256=artifact_sha,
                    gold_artifact_row_count=row_count,
                    sector=sector,
                    runtime_package_id=runtime_package_id,
                    runtime_manifest_key=runtime_manifest_key,
                    runtime_manifest_sha256=runtime_sha,
                    runtime_validation_id=validation_id,
                    model_id=str(runtime["source_model_id"]),
                    model_version=str(runtime["model_version"]),
                    evaluation_run_id=str(runtime["source_evaluation_run_id"]),
                    dataset_view_version=str(
                        runtime.get("dataset_view_version", "gold-v1")
                    ),
                    dataset_view_fingerprint=str(
                        runtime.get("dataset_view_fingerprint", "")
                    ),
                    feature_names=list(runtime["feature_order"]),
                    expected_prediction_count=row_count,
                    created_at=str(runtime["created_at"]),
                )
                job_key = f"manifests/inference-jobs/{task_dir}/{job_id}.json"
                job_bytes = json.dumps(
                    asdict(job), sort_keys=True, separators=(",", ":")
                ).encode()
                job_sha = self._put_immutable(job_key, job_bytes)
                subject = "aurora.v1.inference.candidate.requested"
                requests.append(
                    {
                        "schema_version": 1,
                        "event_id": f"inference-request-{job_id}",
                        "event_type": subject,
                        "occurred_at": datetime.now(timezone.utc)
                        .isoformat()
                        .replace("+00:00", "Z"),
                        "task": task,
                        "job_id": job_id,
                        "job_manifest_bucket": self.bucket,
                        "job_manifest_key": job_key,
                        "job_manifest_sha256": job_sha,
                        "runtime_package_id": runtime_package_id,
                        "gold_snapshot_id": snapshot_id,
                        "gold_artifact_key": artifact_key,
                        "sector": sector,
                        "expected_prediction_count": row_count,
                        "producer": "aurora-ml-worker",
                    }
                )
        if not requests:
            raise InferenceJobError("NO_INFERENCE_INPUTS: no non-empty Gold artifacts")
        return requests
