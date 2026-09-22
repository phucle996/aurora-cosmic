"""Candidate Training Workflow Execution & Request Contracts."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import logging
from pathlib import Path
import random
import tempfile
from typing import Any, Callable, Mapping

import torch

from config import Config
from post_train.evaluate import (
    build_candidate_golden_cohort,
    build_candidate_recent_cohort,
    evaluate_candidate_model,
    MlEvaluationError,
)
from post_train.export import ModelRegistry, OnnxRuntimeExporter
from pre_train import (
    build_candidate_ml_view,
    create_deterministic_group_split,
    derive_group_key,
)
from store import MinioObjectStore, TrainingStore
from train.loop import train_candidate_model

LOGGER = logging.getLogger("aurora-ml-training")
TASK_CANDIDATE = "candidate_vetting"
SUPPORTED_TASKS = frozenset({TASK_CANDIDATE})


class TrainingRequestError(ValueError):
    """A dashboard training request is incomplete or unsafe to execute."""


class TrainingExecutionError(RuntimeError):
    """Raised when training fails to converge or produces invalid artifacts."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass(frozen=True)
class TrainingRequest:
    """Explicit, idempotent training request received through JetStream."""

    ticket_id: str
    task: str
    gold_snapshot_ids: tuple[str, ...]
    training_mode: str
    base_model_id: str | None
    compute_target: str
    epochs: int
    batch_size: int
    learning_rate: float
    seed: int

    @classmethod
    def from_payload(cls, payload: Mapping[str, Any]) -> "TrainingRequest":
        ticket_id = str(payload.get("ticket_id") or "").strip()
        task = str(payload.get("task", TASK_CANDIDATE)).strip()
        raw_ids = payload.get("gold_snapshot_ids") or []
        if isinstance(raw_ids, str):
            raw_ids = [value.strip() for value in raw_ids.split(",") if value.strip()]
        if not raw_ids and payload.get("gold_snapshot_id"):
            raw_ids = [payload["gold_snapshot_id"]]
        snapshot_ids = tuple(
            str(value).strip() for value in raw_ids if str(value).strip()
        )
        training_mode = str(payload.get("training_mode", "fine_tune")).strip()
        compute_target = str(payload.get("compute_target", "gpu")).strip().lower()
        base_model_id = str(payload.get("base_model_id", "champion")).strip() or None
        try:
            epochs = int(payload.get("epochs", 50))
            batch_size = int(payload.get("batch_size", 32))
            learning_rate = float(payload.get("learning_rate", 0.001))
            seed = int(payload.get("seed", 42))
        except (TypeError, ValueError) as exc:
            raise TrainingRequestError("INVALID_HYPERPARAMETERS") from exc

        if not ticket_id:
            raise TrainingRequestError("MISSING_TICKET_ID")
        if task not in SUPPORTED_TASKS:
            raise TrainingRequestError(f"UNSUPPORTED_TASK: {task}")
        if not snapshot_ids:
            raise TrainingRequestError("MISSING_GOLD_SNAPSHOT_IDS")
        if training_mode not in ("fine_tune", "scratch"):
            raise TrainingRequestError(f"INVALID_TRAINING_MODE: {training_mode}")
        if compute_target not in ("cpu", "gpu"):
            raise TrainingRequestError(f"INVALID_COMPUTE_TARGET: {compute_target}")

        return cls(
            ticket_id=ticket_id,
            task=task,
            gold_snapshot_ids=snapshot_ids,
            training_mode=training_mode,
            base_model_id=base_model_id,
            compute_target=compute_target,
            epochs=epochs,
            batch_size=batch_size,
            learning_rate=learning_rate,
            seed=seed,
        )


def _development_rows(rows: list[dict[str, Any]], seed: int) -> list[dict[str, Any]]:
    groups: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        lbl = str(row.get("training_label", "")).strip().upper()
        if lbl in ("POSITIVE", "NEGATIVE"):
            gk = derive_group_key(row)
            groups.setdefault(gk, []).append(row)

    # Need at least 3 groups: 2 for train/val split + 1 for golden test.
    # With <= 2 groups, return everything (evaluation will be skipped).
    if len(groups) <= 2:
        return [r for group_rows in groups.values() for r in group_rows]

    pos_groups = sorted(
        k for k, g_rows in groups.items()
        if any(str(r.get("training_label", "")).strip().upper() == "POSITIVE" for r in g_rows)
    )
    neg_groups = sorted(
        k for k, g_rows in groups.items()
        if all(str(r.get("training_label", "")).strip().upper() == "NEGATIVE" for r in g_rows)
    )

    rng = random.Random(seed)
    rng.shuffle(pos_groups)
    rng.shuffle(neg_groups)

    # Reserve groups for golden test: at least 1 per class when possible,
    # but never consume so many that < 2 groups remain for train/val.
    total_groups = len(groups)
    max_reserve = total_groups - 2  # must keep >= 2 for split

    n_pos_test = min(
        max(1, int(len(pos_groups) * 0.15)),
        len(pos_groups) - 1 if len(pos_groups) > 1 else 0,
    )
    n_neg_test = min(
        max(1, int(len(neg_groups) * 0.15)),
        len(neg_groups) - 1 if len(neg_groups) > 1 else 0,
    )

    # Clamp total reserved to max_reserve
    if n_pos_test + n_neg_test > max_reserve:
        # Prefer reserving at least 1 positive group for golden test
        n_pos_test = min(n_pos_test, max(1, max_reserve))
        n_neg_test = min(n_neg_test, max_reserve - n_pos_test)

    golden_groups = set(pos_groups[:n_pos_test] + neg_groups[:n_neg_test])
    return [
        r for k, group_rows in groups.items()
        if k not in golden_groups
        for r in group_rows
    ]


class TrainingApplication:
    """Manages the lifecycle of a training run, cancellation, and checkpoint control."""

    def __init__(
        self,
        config: Config,
        progress: Callable[[dict[str, Any]], None] | None = None,
        logger: Callable[[str, str, str], None] | None = None,
    ):
        self.config = config
        self.progress = progress
        self.logger = logger
        self.objects = MinioObjectStore(config)
        self._controls: dict[str, str] = {}

    def set_control(self, ticket_id: str, action: str) -> None:
        self._controls[ticket_id] = action

    def get_control(self, ticket_id: str) -> str | None:
        return self._controls.get(ticket_id)

    def _log(self, request: TrainingRequest, message: str, level: str = "info") -> None:
        if self.logger is not None:
            self.logger(request.ticket_id, message, level)

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
                "ticket_id": request.ticket_id,
                "task": request.task,
                "status": "running",
                "phase": phase,
                "progress_percent": max(0.0, min(100.0, progress_percent)),
                "occurred_at": _now(),
                **values,
            }
        )

    def _journal(
        self, store: TrainingStore, request: TrainingRequest, **values: Any
    ) -> None:
        record = {
            "schema_version": 1,
            "ticket_id": request.ticket_id,
            "task": request.task,
            "gold_snapshot_ids": list(request.gold_snapshot_ids),
            "updated_at": _now(),
            **values,
        }
        store.write_job(request.ticket_id, record)

    def execute(self, request: TrainingRequest) -> dict[str, Any]:
        with tempfile.TemporaryDirectory(
            prefix=f"aurora-train-{request.ticket_id}-"
        ) as tmp_dir:
            job_dir = Path(tmp_dir)
            store = TrainingStore(self.objects, job_dir, self.config)
            existing = store.read_job(request.ticket_id)
            if existing and existing.get("status") == "COMPLETED":
                return dict(existing.get("result", {}))

            self._journal(store, request, status="RUNNING", started_at=_now())
            try:
                self._log(
                    request,
                    f"Accepted experiment specification for ticket {request.ticket_id} ({request.compute_target.upper()})",
                )
                self._progress(request, "loading_gold", 5)
                self._log(
                    request,
                    f"Loading {len(request.gold_snapshot_ids)} Gold snapshot(s) from MinIO...",
                )
                loaded = store.load_gold_snapshots(
                    request.task, request.gold_snapshot_ids
                )
                self._log(
                    request,
                    f"Loaded {len(loaded.rows):,} observations from Gold snapshots",
                )
                self._progress(
                    request,
                    "preparing_dataset",
                    14,
                    loaded_rows=len(loaded.rows),
                )
                result = self._train_and_package(request, loaded, store, job_dir)
            except Exception as exc:
                is_cancelled = "CANCELLED" in str(exc).upper()
                self._log(
                    request,
                    f"Experiment cancelled by operator: {exc}"
                    if is_cancelled
                    else f"Experiment failed: {exc}",
                    level="warn" if is_cancelled else "error",
                )
                self._journal(
                    store,
                    request,
                    status="CANCELLED" if is_cancelled else "FAILED",
                    failed_at=_now(),
                    error_code=type(exc).__name__,
                    error=str(exc),
                )
                raise
            self._log(
                request,
                "Training, evaluation, ONNX package export and registration completed successfully",
                level="success",
            )
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

        view = build_candidate_ml_view(loaded.manifest, development_rows)
        if view.positive_count == 0 or view.negative_count == 0:
            raise TrainingExecutionError("NO_SUPERVISED_LABELS_IN_GOLD")
        split = create_deterministic_group_split(view, seed=request.seed)
        self._log(
            request,
            f"Built ML view: {view.positive_count} positive, {view.negative_count} negative targets across {len(split.assignments)} groups",
        )
        self._progress(
            request,
            "training",
            20,
            current_epoch=0,
            total_epochs=request.epochs,
            supervised_rows=view.positive_count + view.negative_count,
        )
        self._log(
            request,
            f"Starting PyTorch optimization ({request.epochs} epochs, batch_size={request.batch_size}, lr={request.learning_rate}) on {request.compute_target.upper()}...",
        )

        def on_epoch_progress(epoch_data: dict[str, Any]) -> None:
            ep = int(epoch_data.get("current_epoch", 0))
            tot = int(epoch_data.get("total_epochs", request.epochs))
            tl = epoch_data.get("train_loss")
            vl = epoch_data.get("val_loss")
            bep = epoch_data.get("best_epoch")
            is_best = ep == bep
            self._progress(
                request,
                "training",
                20 + 55 * ep / tot,
                **epoch_data,
            )
            tl_str = f"{tl:.4f}" if isinstance(tl, (int, float)) else "—"
            vl_str = f"{vl:.4f}" if isinstance(vl, (int, float)) else "—"
            msg = f"Epoch {ep}/{tot} — train_loss: {tl_str} · val_loss: {vl_str}{' ★ (Best)' if is_best else ''}"
            self._log(request, msg, level="success" if is_best else "info")

        training_manifest, checkpoint = train_candidate_model(
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
            progress_callback=on_epoch_progress,
            control_check=lambda: self.get_control(request.ticket_id),
        )
        best_val = getattr(checkpoint, "best_val_loss", None)
        if best_val is None or best_val == float("inf"):
            best_val = getattr(training_manifest, "best_validation_loss", 0.0)
        self._log(
            request,
            f"Training complete: best epoch {training_manifest.best_epoch} with val_loss {best_val:.4f}",
            level="success",
        )

        self._progress(request, "evaluating", 78)
        self._log(
            request,
            "Evaluating multi-cohort generalizability (Golden Test & Recent Holdout)...",
        )
        try:
            golden = build_candidate_golden_cohort(loaded.manifest, rows, split)
        except MlEvaluationError as exc:
            self._log(
                request,
                f"Golden Test cohort skipped (insufficient unseen groups): {exc}",
                level="warn",
            )
            golden = None
        try:
            recent = build_candidate_recent_cohort(loaded.manifest, rows, split, golden) if golden else None
        except MlEvaluationError:
            recent = None

        model_state = torch.load(
            artifacts_dir / "training" / "model.pt",
            map_location="cpu",
            weights_only=True,
        )
        if golden is not None:
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
        else:
            evaluation = None
        task_dir = "candidate"
        registry_task = TASK_CANDIDATE

        self._progress(request, "packaging_model", 88)
        self._log(request, "Registering model candidate in Model Registry...")
        registry_root = artifacts_dir / "registry"
        evaluation_dir = artifacts_dir / "evaluation" / evaluation.evaluation_run_id
        registry = ModelRegistry(str(registry_root))
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
        exporter = OnnxRuntimeExporter(
            registry_root=str(registry_root), runtime_root=str(runtime_root)
        )
        self._log(
            request,
            f"Exporting ONNX opset 17 package for {model.model_id} and checking parity...",
        )
        runtime = exporter.export_candidate_runtime_package(
            model_id=model.model_id,
            evaluation_run_manifest_path=str(evaluation_dir / "manifest.json"),
            validation_rows=development_rows,
        )
        self._log(
            request,
            f"ONNX Runtime package {runtime.runtime_package_id} verified with exact parity",
            level="success",
        )

        self._progress(request, "persisting_artifacts", 95)
        self._log(
            request,
            "Persisting immutable training manifests and weights to Object Storage...",
        )
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
        self._progress(request, "completed", 100)
        self._log(
            request,
            "All artifacts uploaded to MinIO bucket successfully",
            level="success",
        )

        return {
            "status": "completed",
            "ticket_id": request.ticket_id,
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
            "runtime_validation_status": "READY",
            "phase": "completed",
            "progress_percent": 100,
        }
