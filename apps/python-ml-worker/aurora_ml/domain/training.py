"""Training job contracts.  These intentionally contain no I/O."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping


class TrainingRequestError(ValueError):
    """A dashboard training request is incomplete or unsafe to execute."""


TASK_CANDIDATE = "candidate_vetting"
# Retained as a legacy import while the unreachable training implementation is
# removed incrementally. SUPPORTED_TASKS is the executable contract.
TASK_ANOMALY = "astronomical_anomaly_detection"
SUPPORTED_TASKS = frozenset({TASK_CANDIDATE})


@dataclass(frozen=True)
class TrainingRequest:
    """Explicit, idempotent training request received through JetStream."""

    job_id: str
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
        job_id = str(payload.get("training_job_id", "")).strip()
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

        if not job_id:
            raise TrainingRequestError("MISSING_TRAINING_JOB_ID")
        if task not in SUPPORTED_TASKS:
            raise TrainingRequestError(f"UNSUPPORTED_TRAINING_TASK: {task}")
        if not snapshot_ids:
            raise TrainingRequestError("MISSING_GOLD_SNAPSHOT_ID")
        if len(set(snapshot_ids)) != len(snapshot_ids):
            raise TrainingRequestError("DUPLICATE_GOLD_SNAPSHOT_ID")
        if training_mode not in {"scratch", "fine_tune"}:
            raise TrainingRequestError("INVALID_TRAINING_MODE")
        if compute_target not in {"cpu", "gpu"}:
            raise TrainingRequestError("INVALID_COMPUTE_TARGET")
        if epochs < 1 or batch_size < 1 or learning_rate <= 0:
            raise TrainingRequestError("INVALID_HYPERPARAMETERS")
        return cls(
            job_id=job_id,
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

    @property
    def task_dir(self) -> str:
        return "candidate"
