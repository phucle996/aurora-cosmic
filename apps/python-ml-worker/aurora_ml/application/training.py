"""The only production training orchestration path.

It deliberately refuses fabricated data, unknown Gold revisions and automatic
promotion.  Scientific provenance is more important than producing a model.
"""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
from pathlib import Path
from typing import Any, Callable

import torch

from aurora_ml.config import Config
from aurora_ml.domain.training import (
    TASK_ANOMALY,
    TASK_CANDIDATE,
    TrainingRequest,
)
from aurora_ml.export_onnx import RuntimeExporter
from aurora_ml.infrastructure.object_store import MinioObjectStore
from aurora_ml.infrastructure.training_store import TrainingStore
from aurora_ml.inference_dispatch import MinioInferenceJobPlanner
from aurora_ml.ml.anomaly.train import train_anomaly_model
from aurora_ml.ml.candidate.train import train_candidate_model
from aurora_ml.ml.datasets.splits import (
    build_anomaly_ml_view,
    build_candidate_ml_view,
    create_anomaly_group_split,
    create_deterministic_group_split,
    derive_group_key,
)
from aurora_ml.ml.evaluate.cohort import (
    MlEvaluationError,
    build_anomaly_golden_cohort,
    build_anomaly_recent_cohort,
    build_candidate_golden_cohort,
    build_candidate_recent_cohort,
)
from aurora_ml.ml.evaluate.engine import (
    evaluate_anomaly_model,
    evaluate_candidate_model,
)
from aurora_ml.ml.registry import ModelRegistry


class TrainingExecutionError(RuntimeError):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _development_rows(rows: list[dict[str, Any]], seed: int) -> list[dict[str, Any]]:
    """Hold out complete target groups before making the train/validation split."""
    groups = sorted({derive_group_key(row) for row in rows})
    if len(groups) < 4:
        raise TrainingExecutionError("INSUFFICIENT_TARGET_GROUPS_FOR_EVALUATION")
    development = {
        group
        for group in groups
        if int(
            hashlib.sha256(f"ml-development-v1:{seed}:{group}".encode()).hexdigest()[
                :8
            ],
            16,
        )
        % 100
        < 70
    }
    # A stable small-sample fallback chooses groups, never fabricates rows.
    if len(development) < 2 or len(development) == len(groups):
        development = set(groups[: max(2, len(groups) - 2)])
    return [row for row in rows if derive_group_key(row) in development]


class TrainingApplication:
    def __init__(
        self,
        config: Config,
        objects: MinioObjectStore | None = None,
        progress: Callable[[dict[str, Any]], None] | None = None,
    ):
        self.config = config
        self.objects = objects or MinioObjectStore(config)
        self.progress = progress

    def _progress(
        self,
        request: TrainingRequest,
        phase: str,
        progress_percent: float,
        **values: Any,
    ) -> None:
        if self.progress is None:
            return
        self.progress(
            {
                "schema_version": 1,
                "job_id": request.job_id,
                "task": request.task,
                "status": "running",
                "phase": phase,
                "progress_percent": max(0.0, min(100.0, progress_percent)),
                "occurred_at": _now(),
                **values,
            }
        )

    def _job_dir(self, request: TrainingRequest) -> Path:
        directory = Path(self.config.work_dir) / "jobs" / request.job_id
        directory.mkdir(parents=True, exist_ok=True)
        return directory

    def _journal(
        self, store: TrainingStore, request: TrainingRequest, **values: Any
    ) -> None:
        record = {
            "schema_version": 1,
            "job_id": request.job_id,
            "task": request.task,
            "gold_snapshot_ids": list(request.gold_snapshot_ids),
            "updated_at": _now(),
            **values,
        }
        store.write_job(request.job_id, record)

    def execute(self, request: TrainingRequest) -> dict[str, Any]:
        existing_store = TrainingStore(
            self.objects, self._job_dir(request), self.config
        )
        existing = existing_store.read_job(request.job_id)
        if existing and existing.get("status") == "COMPLETED":
            return dict(existing.get("result", {}))
        if self.config.device == "cpu" and request.compute_target == "gpu":
            raise TrainingExecutionError("GPU_TARGET_UNAVAILABLE")

        job_dir = self._job_dir(request)
        store = TrainingStore(self.objects, job_dir, self.config)
        self._journal(store, request, status="RUNNING", started_at=_now())
        try:
            self._progress(request, "loading_gold", 5)
            loaded = store.load_gold_snapshots(request.task, request.gold_snapshot_ids)
            self._progress(
                request,
                "preparing_dataset",
                14,
                loaded_rows=len(loaded.rows),
            )
            result = self._train_and_package(request, loaded, store, job_dir)
        except Exception as exc:
            self._journal(
                store,
                request,
                status="FAILED",
                failed_at=_now(),
                error_code=type(exc).__name__,
                error=str(exc),
            )
            raise
        self._journal(
            store, request, status="COMPLETED", completed_at=_now(), result=result
        )
        return result

    def _resolve_base_model(
        self, request: TrainingRequest, store: TrainingStore, job_dir: Path
    ) -> Path | None:
        if request.training_mode == "scratch" or not request.base_model_id:
            return None
        model_id = request.base_model_id
        if model_id == "champion":
            model_id = store.champion_model_id(request.task)
        if not model_id:
            return None
        destination = job_dir / "base" / "model.pt"
        if not store.download_model_weights(request.task, model_id, destination):
            raise TrainingExecutionError(f"BASE_MODEL_NOT_FOUND: {model_id}")
        return destination

    def _train_and_package(
        self, request: TrainingRequest, loaded: Any, store: TrainingStore, job_dir: Path
    ) -> dict[str, Any]:
        rows = loaded.rows
        development_rows = _development_rows(rows, request.seed)
        artifacts_dir = job_dir / "artifacts"
        artifacts_dir.mkdir(parents=True, exist_ok=True)
        base_model_path = self._resolve_base_model(request, store, job_dir)

        if request.task == TASK_CANDIDATE:
            view = build_candidate_ml_view(loaded.manifest, development_rows)
            if view.positive_count == 0 or view.negative_count == 0:
                raise TrainingExecutionError("NO_SUPERVISED_LABELS_IN_GOLD")
            split = create_deterministic_group_split(view, seed=request.seed)
            self._progress(
                request,
                "training",
                20,
                current_epoch=0,
                total_epochs=request.epochs,
                supervised_rows=view.positive_count + view.negative_count,
            )
            training_manifest, _ = train_candidate_model(
                gold_manifest=loaded.manifest,
                split_manifest=split,
                rows=development_rows,
                training_seed=request.seed,
                epochs=request.epochs,
                batch_size=request.batch_size,
                learning_rate=request.learning_rate,
                dest_dir=str(artifacts_dir / "training"),
                device_str=request.compute_target,
                max_vram_mb=self.config.max_vram_mb
                if request.compute_target == "gpu"
                else 0,
                base_model_path=str(base_model_path) if base_model_path else None,
                progress_callback=lambda epoch: self._progress(
                    request,
                    "training",
                    20 + 55 * int(epoch["current_epoch"]) / request.epochs,
                    **epoch,
                ),
            )
            self._progress(request, "evaluating", 78)
            golden = build_candidate_golden_cohort(loaded.manifest, rows, split)
            try:
                recent = build_candidate_recent_cohort(
                    loaded.manifest, rows, split, golden
                )
            except MlEvaluationError:
                recent = None
            model_state = torch.load(
                artifacts_dir / "training" / "model.pt",
                map_location="cpu",
                weights_only=True,
            )
            evaluation, _, _ = evaluate_candidate_model(
                training_manifest=training_manifest,
                training_split=split,
                golden_cohort=golden,
                training_rows=development_rows,
                golden_rows=rows,
                model_state_dict=model_state,
                preprocessor_json_path=str(
                    artifacts_dir / "training" / "preprocessing.json"
                ),
                recent_cohort=recent,
                recent_rows=rows if recent else None,
                dest_dir=str(artifacts_dir / "evaluation"),
            )
            task_dir = "candidate"
            exporter_method = "export_candidate_runtime_package"
            registry_task = TASK_CANDIDATE
        else:
            view = build_anomaly_ml_view(loaded.manifest, development_rows)
            split = create_anomaly_group_split(view, seed=request.seed)
            training_manifest, _ = train_anomaly_model(
                gold_manifest=loaded.manifest,
                split_manifest=split,
                rows=development_rows,
                training_seed=request.seed,
                epochs=request.epochs,
                batch_size=request.batch_size,
                learning_rate=request.learning_rate,
                dest_dir=str(artifacts_dir / "training"),
                device_str=request.compute_target,
                max_vram_mb=self.config.max_vram_mb
                if request.compute_target == "gpu"
                else 0,
            )
            golden = build_anomaly_golden_cohort(loaded.manifest, rows, split)
            try:
                recent = build_anomaly_recent_cohort(
                    loaded.manifest, rows, split, golden
                )
            except MlEvaluationError:
                recent = None
            model_state = torch.load(
                artifacts_dir / "training" / "model.pt",
                map_location="cpu",
                weights_only=True,
            )
            evaluation, _, _ = evaluate_anomaly_model(
                training_manifest=training_manifest,
                training_split=split,
                golden_cohort=golden,
                training_rows=development_rows,
                golden_rows=rows,
                model_state_dict=model_state,
                preprocessor_json_path=str(
                    artifacts_dir / "training" / "preprocessing.json"
                ),
                recent_cohort=recent,
                recent_rows=rows if recent else None,
                dest_dir=str(artifacts_dir / "evaluation"),
            )
            task_dir = "anomaly"
            exporter_method = "export_anomaly_runtime_package"
            registry_task = TASK_ANOMALY

        self._progress(request, "packaging_runtime", 87)
        evaluation_dir = artifacts_dir / "evaluation" / evaluation.evaluation_run_id
        registry_root = artifacts_dir / "registry"
        registry = ModelRegistry(registry_root=str(registry_root))
        model = registry.register_model_package(
            task=registry_task,
            training_run_manifest_path=str(
                artifacts_dir / "training" / "manifest.json"
            ),
            evaluation_run_manifest_path=str(evaluation_dir / "manifest.json"),
            model_pt_source_path=str(artifacts_dir / "training" / "model.pt"),
            preprocessing_json_source_path=str(
                artifacts_dir / "training" / "preprocessing.json"
            ),
        )
        runtime_root = artifacts_dir / "runtime"
        exporter = RuntimeExporter(
            registry_root=str(registry_root), runtime_root=str(runtime_root)
        )
        runtime = getattr(exporter, exporter_method)(
            model_id=model.model_id,
            evaluation_run_manifest_path=str(evaluation_dir / "manifest.json"),
            validation_rows=development_rows,
        )

        self._progress(request, "persisting_artifacts", 93)
        store.upload_tree(
            artifacts_dir / "training",
            f"models/training-runs/{task_dir}/{training_manifest.training_run_id}",
        )
        store.upload_tree(
            evaluation_dir,
            f"models/evaluations/{task_dir}/{evaluation.evaluation_run_id}",
        )
        store.upload_tree(
            registry_root / task_dir / model.model_id,
            f"models/registry/{task_dir}/{model.model_id}",
        )
        runtime_dir = runtime_root / task_dir / runtime.runtime_package_id
        store.upload_tree(
            runtime_dir,
            f"models/runtime/{registry_task}/{model.model_id}/{runtime.runtime_package_id}",
        )
        runtime_manifest_key = (
            f"models/runtime/{registry_task}/{model.model_id}/"
            f"{runtime.runtime_package_id}/manifest.json"
        )
        self._progress(request, "planning_inference", 97)
        inference_requests = MinioInferenceJobPlanner(
            self.objects.client, self.objects.bucket
        ).plan(
            task=registry_task,
            gold_snapshot_ids=list(request.gold_snapshot_ids),
            runtime_package_id=runtime.runtime_package_id,
            runtime_manifest_key=runtime_manifest_key,
        )

        return {
            "status": "completed",
            "job_id": request.job_id,
            "task": registry_task,
            "gold_snapshot_id": loaded.snapshot_id,
            "gold_snapshot_ids": list(request.gold_snapshot_ids),
            "training_run_id": training_manifest.training_run_id,
            "evaluation_run_id": evaluation.evaluation_run_id,
            "model_id": model.model_id,
            "runtime_package_id": runtime.runtime_package_id,
            "runtime_manifest_key": runtime_manifest_key,
            "auto_promoted": False,
            "promotion_status": "AWAITING_MANUAL_REVIEW",
            "runtime_validation_status": "REQUESTED",
            "inference_requests": inference_requests,
            "phase": "completed",
            "progress_percent": 100,
        }


def run_training_pipeline(payload: dict[str, Any], config: Config) -> dict[str, Any]:
    """Compatibility entrypoint for the service; no fallback behavior."""
    return TrainingApplication(config).execute(TrainingRequest.from_payload(payload))
