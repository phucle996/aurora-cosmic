"""Production Inference Job Planning & Manifest Contracts (Phase 7.1).

Plans immutable inference jobs from committed Gold partition artifacts and
Rust-qualified runtime packages.
"""

from dataclasses import asdict, dataclass
import hashlib
import json
import os
from typing import Any, Dict, List, Optional, Tuple


class InferenceJobError(Exception):
    """Raised when inference job validation or planning fails."""


@dataclass(frozen=True)
class InferenceJobManifest:
    """Immutable inference job specification conforming to `inference-job-v1`."""

    schema_version: int
    job_id: str
    job_fingerprint: str
    task: str
    selection_policy_version: str
    gold_snapshot_id: str
    gold_manifest_key: str
    gold_manifest_sha256: str
    gold_dataset: str
    gold_schema_version: str
    gold_artifact_key: str
    gold_artifact_content_sha256: str
    gold_artifact_row_count: int
    sector: int
    runtime_package_id: str
    runtime_manifest_key: str
    runtime_manifest_sha256: str
    runtime_validation_id: str
    model_id: str
    model_version: str
    evaluation_run_id: str
    dataset_view_version: str
    dataset_view_fingerprint: str
    feature_names: List[str]
    expected_prediction_count: int
    created_at: str
    producer: str = "python-ml-worker"

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def compute_job_fingerprint(
    task: str,
    selection_policy_version: str,
    gold_snapshot_id: str,
    gold_manifest_sha256: str,
    gold_artifact_key: str,
    gold_artifact_content_sha256: str,
    runtime_package_id: str,
    runtime_manifest_sha256: str,
    runtime_validation_id: str,
) -> Tuple[str, str]:
    """Compute deterministic job ID and SHA-256 fingerprint."""
    payload = {
        "task": task,
        "selection_policy_version": selection_policy_version,
        "gold_snapshot_id": gold_snapshot_id,
        "gold_manifest_sha256": gold_manifest_sha256,
        "gold_artifact_key": gold_artifact_key,
        "gold_artifact_content_sha256": gold_artifact_content_sha256,
        "runtime_package_id": runtime_package_id,
        "runtime_manifest_sha256": runtime_manifest_sha256,
        "runtime_validation_id": runtime_validation_id,
    }
    canonical_json = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    fp = hashlib.sha256(canonical_json).hexdigest()
    job_id = f"inference-job-v1-{fp[:16]}"
    return job_id, fp


class InferenceJobPlanner:
    """Discovers Gold partition artifacts and materializes immutable inference job manifests."""

    def __init__(
        self,
        gold_root: str,
        runtime_root: str,
        validation_root: str,
        manifest_root: str,
    ):
        self.gold_root = gold_root
        self.runtime_root = runtime_root
        self.validation_root = validation_root
        self.manifest_root = manifest_root

    def plan_candidate_jobs(
        self,
        gold_snapshot_id: str,
        runtime_package_id: str,
        runtime_validation_id: Optional[str] = None,
        dry_run: bool = False,
    ) -> List[InferenceJobManifest]:
        """Plan inference jobs for Candidate Vetting."""
        return self._plan_jobs(
            task="candidate_vetting",
            gold_dir_name="candidate",
            runtime_dir_name="candidate",
            selection_policy_version="candidate-inference-selection-v1",
            expected_gold_schema="gold-candidate-v1",
            gold_snapshot_id=gold_snapshot_id,
            runtime_package_id=runtime_package_id,
            runtime_validation_id=runtime_validation_id,
            dry_run=dry_run,
        )

    def plan_anomaly_jobs(
        self,
        gold_snapshot_id: str,
        runtime_package_id: str,
        runtime_validation_id: Optional[str] = None,
        dry_run: bool = False,
    ) -> List[InferenceJobManifest]:
        """Plan inference jobs for Astronomical Anomaly Detection."""
        return self._plan_jobs(
            task="astronomical_anomaly_detection",
            gold_dir_name="anomaly",
            runtime_dir_name="anomaly",
            selection_policy_version="anomaly-lightcurve-inference-selection-v1",
            expected_gold_schema="gold-anomaly-v1",
            gold_snapshot_id=gold_snapshot_id,
            runtime_package_id=runtime_package_id,
            runtime_validation_id=runtime_validation_id,
            dry_run=dry_run,
        )

    def _plan_jobs(
        self,
        task: str,
        gold_dir_name: str,
        runtime_dir_name: str,
        selection_policy_version: str,
        expected_gold_schema: str,
        gold_snapshot_id: str,
        runtime_package_id: str,
        runtime_validation_id: Optional[str] = None,
        dry_run: bool = False,
    ) -> List[InferenceJobManifest]:
        # 1. Validate and load Gold snapshot manifest
        gold_snapshot_dir = os.path.join(self.gold_root, gold_dir_name, gold_snapshot_id)
        gold_manifest_path = os.path.join(gold_snapshot_dir, "manifest.json")
        if not os.path.exists(gold_manifest_path):
            raise InferenceJobError(f"Committed Gold manifest not found: {gold_manifest_path}")

        with open(gold_manifest_path, "r", encoding="utf-8") as f:
            gold_manifest_data = json.load(f)

        gold_manifest_sha = hashlib.sha256(open(gold_manifest_path, "rb").read()).hexdigest()

        # 2. Validate and load Runtime Package manifest
        runtime_pkg_dir = os.path.join(self.runtime_root, runtime_dir_name, runtime_package_id)
        runtime_manifest_path = os.path.join(runtime_pkg_dir, "manifest.json")
        if not os.path.exists(runtime_manifest_path):
            raise InferenceJobError(f"Runtime package manifest not found: {runtime_manifest_path}")

        with open(runtime_manifest_path, "r", encoding="utf-8") as f:
            runtime_manifest_data = json.load(f)

        runtime_manifest_sha = hashlib.sha256(open(runtime_manifest_path, "rb").read()).hexdigest()

        # 3. Validate and resolve runtime qualification (CPU PASS record)
        resolved_val_id = self._resolve_runtime_validation(
            runtime_package_id=runtime_package_id,
            explicit_val_id=runtime_validation_id,
        )

        # 4. Filter compatible non-empty Gold artifacts
        artifacts = gold_manifest_data.get("artifacts", [])
        if not artifacts:
            # Check partition files
            partitions = gold_manifest_data.get("partitions", [])
            if partitions:
                artifacts = partitions

        if not artifacts:
            raise InferenceJobError(f"NO_INFERENCE_INPUTS: No artifacts found in snapshot {gold_snapshot_id}")

        planned_manifests = []
        out_jobs_dir = os.path.join(self.manifest_root, "inference-jobs", runtime_dir_name)
        os.makedirs(out_jobs_dir, exist_ok=True)

        for art in artifacts:
            row_count = art.get("row_count", 0)
            if row_count <= 0:
                continue  # Skip empty artifacts explicitly

            art_key = art.get("artifact_key", art.get("path", ""))
            art_sha = art.get("content_sha256", art.get("sha256", "0" * 64))
            sector = art.get("sector", 1)

            job_id, job_fp = compute_job_fingerprint(
                task=task,
                selection_policy_version=selection_policy_version,
                gold_snapshot_id=gold_snapshot_id,
                gold_manifest_sha256=gold_manifest_sha,
                gold_artifact_key=art_key,
                gold_artifact_content_sha256=art_sha,
                runtime_package_id=runtime_package_id,
                runtime_manifest_sha256=runtime_manifest_sha,
                runtime_validation_id=resolved_val_id,
            )

            manifest = InferenceJobManifest(
                schema_version=1,
                job_id=job_id,
                job_fingerprint=job_fp,
                task=task,
                selection_policy_version=selection_policy_version,
                gold_snapshot_id=gold_snapshot_id,
                gold_manifest_key=os.path.relpath(gold_manifest_path, self.gold_root),
                gold_manifest_sha256=gold_manifest_sha,
                gold_dataset=gold_dir_name,
                gold_schema_version=gold_manifest_data.get("gold_schema_version", expected_gold_schema),
                gold_artifact_key=art_key,
                gold_artifact_content_sha256=art_sha,
                gold_artifact_row_count=row_count,
                sector=sector,
                runtime_package_id=runtime_package_id,
                runtime_manifest_key=os.path.relpath(runtime_manifest_path, self.runtime_root),
                runtime_manifest_sha256=runtime_manifest_sha,
                runtime_validation_id=resolved_val_id,
                model_id=runtime_manifest_data.get("source_model_id", "m-unknown"),
                model_version=runtime_manifest_data.get("model_version", "v1"),
                evaluation_run_id=runtime_manifest_data.get("source_evaluation_run_id", "e-unknown"),
                dataset_view_version=runtime_manifest_data.get("dataset_view_version", "v1"),
                dataset_view_fingerprint=runtime_manifest_data.get("dataset_view_fingerprint", "f" * 64),
                feature_names=list(runtime_manifest_data.get("feature_order", [])),
                expected_prediction_count=row_count,
                created_at="2026-08-08T00:00:00Z",
                producer="python-ml-worker",
            )

            if not dry_run:
                job_file_path = os.path.join(out_jobs_dir, f"{job_id}.json")
                if os.path.exists(job_file_path):
                    with open(job_file_path, "r", encoding="utf-8") as f:
                        existing = json.load(f)
                    if existing.get("job_fingerprint") != job_fp:
                        raise InferenceJobError(f"INFERENCE_JOB_CONFLICT: Job {job_id} already exists with different content")
                else:
                    with open(job_file_path, "w", encoding="utf-8") as f:
                        json.dump(manifest.to_dict(), f, indent=2)

            planned_manifests.append(manifest)

        return planned_manifests

    def _resolve_runtime_validation(
        self,
        runtime_package_id: str,
        explicit_val_id: Optional[str] = None,
    ) -> str:
        """Find matching CPU PASS validation record."""
        if not os.path.exists(self.validation_root):
            raise InferenceJobError(f"No runtime validation records found at {self.validation_root}")

        candidates = []
        for root, _, files in os.walk(self.validation_root):
            for file in files:
                if file.endswith(".json"):
                    val_path = os.path.join(root, file)
                    try:
                        with open(val_path, "r", encoding="utf-8") as f:
                            rec = json.load(f)
                        if (
                            rec.get("runtime_package_id") == runtime_package_id
                            and rec.get("validation_status") == "PASS"
                        ):
                            candidates.append(rec)
                    except Exception:
                        continue

        if not candidates:
            raise InferenceJobError(f"UNQUALIFIED_RUNTIME: No CPU PASS validation record found for {runtime_package_id}")

        if explicit_val_id:
            for c in candidates:
                if c.get("validation_record_id") == explicit_val_id:
                    return explicit_val_id
            raise InferenceJobError(f"Explicit validation ID {explicit_val_id} not found among PASS records")

        # Select deterministic smallest ID
        candidates.sort(key=lambda x: x.get("validation_record_id", ""))
        return candidates[0]["validation_record_id"]
