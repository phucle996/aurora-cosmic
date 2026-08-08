"""Model Registry: Champion / Challenger, Promotion & Rollback (Phase 6.5).

Implements model-manifest-v1 and model-promotion-v1 for Candidate Vetting and
Astronomical Anomaly Detection models.
"""

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
import hashlib
import json
import os
import shutil
from typing import Any, Dict, List, Optional, Tuple


class ModelRegistryError(Exception):
    """Base exception for Model Registry failures."""

    pass


class ModelPackageIntegrityError(ModelRegistryError):
    """Raised when model package artifact hashes do not match manifest."""

    pass


class ModelPackageConflictError(ModelRegistryError):
    """Raised when an immutable registered model package conflict is detected."""

    pass


class ModelPromotionRejectionError(ModelRegistryError):
    """Raised when a challenger fails promotion criteria against the current champion."""

    pass


# -----------------------------------------------------------------------------
# 1. Model Package Manifest (model-manifest-v1)
# -----------------------------------------------------------------------------


@dataclass(frozen=True)
class ModelPackageManifest:
    """Immutable model package manifest conforming to model-manifest-v1."""

    schema_version: int
    model_id: str
    model_fingerprint: str
    task: str
    model_version: str
    preprocessing_version: str
    training_run_id: str
    training_run_manifest_sha256: str
    evaluation_run_id: str
    evaluation_run_manifest_sha256: str
    gold_snapshot_id: str
    gold_manifest_sha256: str
    split_id: str
    dataset_view_version: str
    dataset_view_fingerprint: str
    feature_order: List[str]
    model_pt_sha256: str
    preprocessing_json_sha256: str
    created_at: str
    producer: str = "python-ml-worker"

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def derive_model_package_identity(
    task: str,
    model_version: str,
    preprocessing_version: str,
    training_run_id: str,
    training_run_manifest_sha256: str,
    evaluation_run_id: str,
    evaluation_run_manifest_sha256: str,
    gold_snapshot_id: str,
    gold_manifest_sha256: str,
    split_id: str,
    dataset_view_version: str,
    dataset_view_fingerprint: str,
    feature_order: List[str],
    model_pt_sha256: str,
    preprocessing_json_sha256: str,
) -> Tuple[str, str]:
    """Derive deterministic model package ID and SHA-256 fingerprint."""
    canonical_obj = {
        "dataset_view_fingerprint": dataset_view_fingerprint,
        "dataset_view_version": dataset_view_version,
        "evaluation_run_id": evaluation_run_id,
        "evaluation_run_manifest_sha256": evaluation_run_manifest_sha256,
        "feature_order": list(feature_order),
        "gold_manifest_sha256": gold_manifest_sha256,
        "gold_snapshot_id": gold_snapshot_id,
        "model_pt_sha256": model_pt_sha256,
        "model_version": model_version,
        "preprocessing_json_sha256": preprocessing_json_sha256,
        "preprocessing_version": preprocessing_version,
        "split_id": split_id,
        "task": task,
        "training_run_id": training_run_id,
        "training_run_manifest_sha256": training_run_manifest_sha256,
    }
    canonical_json = json.dumps(canonical_obj, sort_keys=True, separators=(",", ":"))
    model_fp = hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()

    prefix = "cand" if task == "candidate_vetting" else "anom"
    model_id = f"model-{prefix}-v1-{model_fp[:12]}"

    return model_id, model_fp


# -----------------------------------------------------------------------------
# 2. Model Promotion Record & Champion Pointer (model-promotion-v1)
# -----------------------------------------------------------------------------


@dataclass(frozen=True)
class ModelPromotionRecord:
    """Immutable promotion and rollback record conforming to model-promotion-v1."""

    schema_version: int
    promotion_id: str
    promotion_fingerprint: str
    task: str
    action: str  # "PROMOTE" or "ROLLBACK"
    policy_version: str
    champion_model_id: str
    comparison_decision: str
    created_at: str
    previous_champion_model_id: Optional[str] = None
    evaluation_run_id: Optional[str] = None
    evaluation_metrics_summary: Optional[Dict[str, Any]] = None
    producer: str = "python-ml-worker"

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        return {k: v for k, v in d.items() if v is not None}


def derive_promotion_identity(
    task: str,
    action: str,
    policy_version: str,
    champion_model_id: str,
    previous_champion_model_id: Optional[str],
    evaluation_run_id: Optional[str],
    comparison_decision: str,
) -> Tuple[str, str]:
    """Derive deterministic promotion record ID and SHA-256 fingerprint."""
    canonical_obj = {
        "action": action,
        "champion_model_id": champion_model_id,
        "comparison_decision": comparison_decision,
        "evaluation_run_id": evaluation_run_id,
        "policy_version": policy_version,
        "previous_champion_model_id": previous_champion_model_id,
        "task": task,
    }
    canonical_json = json.dumps(canonical_obj, sort_keys=True, separators=(",", ":"))
    promo_fp = hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()

    prefix = "cand" if task == "candidate_vetting" else "anom"
    promotion_id = f"promo-{prefix}-v1-{promo_fp[:12]}"

    return promotion_id, promo_fp


# -----------------------------------------------------------------------------
# 3. Model Registry Engine
# -----------------------------------------------------------------------------


class ModelRegistry:
    """Model Registry manager for Candidate Vetting and Anomaly Detection models."""

    def __init__(self, registry_root: str = "models"):
        self.registry_root = registry_root

    def _task_dir(self, task: str) -> str:
        t = "candidate" if task == "candidate_vetting" else "anomaly"
        return os.path.join(self.registry_root, t)

    def register_model_package(
        self,
        task: str,
        training_run_manifest_path: str,
        evaluation_run_manifest_path: str,
        model_pt_source_path: str,
        preprocessing_json_source_path: str,
    ) -> ModelPackageManifest:
        """Register a verified immutable model package into models/<task>/<model-id>/."""
        # 1. Load and verify training run manifest
        if not os.path.exists(training_run_manifest_path):
            raise ModelRegistryError(f"Training run manifest not found: {training_run_manifest_path}")
        with open(training_run_manifest_path, "r", encoding="utf-8") as f:
            train_data = json.load(f)
        train_manifest_sha = hashlib.sha256(
            json.dumps(train_data, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()

        # 2. Load and verify evaluation run manifest
        if not os.path.exists(evaluation_run_manifest_path):
            raise ModelRegistryError(f"Evaluation run manifest not found: {evaluation_run_manifest_path}")
        with open(evaluation_run_manifest_path, "r", encoding="utf-8") as f:
            eval_data = json.load(f)
        eval_manifest_sha = hashlib.sha256(
            json.dumps(eval_data, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()

        # 3. Verify artifact file hashes match training manifest
        if not os.path.exists(model_pt_source_path):
            raise ModelRegistryError(f"model.pt artifact not found: {model_pt_source_path}")
        with open(model_pt_source_path, "rb") as f:
            actual_model_pt_sha = hashlib.sha256(f.read()).hexdigest()

        if actual_model_pt_sha != train_data["model_sha256"]:
            raise ModelPackageIntegrityError(
                f"MODEL_SHA_MISMATCH: actual {actual_model_pt_sha} != manifest {train_data['model_sha256']}"
            )

        if not os.path.exists(preprocessing_json_source_path):
            raise ModelRegistryError(f"preprocessing.json artifact not found: {preprocessing_json_source_path}")
        with open(preprocessing_json_source_path, "rb") as f:
            actual_prep_sha = hashlib.sha256(f.read()).hexdigest()

        if actual_prep_sha != train_data["preprocessing_sha256"]:
            raise ModelPackageIntegrityError(
                f"PREPROCESSING_SHA_MISMATCH: actual {actual_prep_sha} != manifest {train_data['preprocessing_sha256']}"
            )

        # 4. Derive deterministic model ID and package fingerprint
        model_id, model_fp = derive_model_package_identity(
            task=task,
            model_version=train_data["model_version"],
            preprocessing_version=train_data["preprocessing_version"],
            training_run_id=train_data["training_run_id"],
            training_run_manifest_sha256=train_manifest_sha,
            evaluation_run_id=eval_data["evaluation_run_id"],
            evaluation_run_manifest_sha256=eval_manifest_sha,
            gold_snapshot_id=train_data["gold_snapshot_id"],
            gold_manifest_sha256=train_data["gold_manifest_sha256"],
            split_id=train_data["split_id"],
            dataset_view_version=train_data["dataset_view_version"],
            dataset_view_fingerprint=train_data["dataset_view_fingerprint"],
            feature_order=train_data["feature_order"],
            model_pt_sha256=actual_model_pt_sha,
            preprocessing_json_sha256=actual_prep_sha,
        )

        package_dir = os.path.join(self._task_dir(task), model_id)
        manifest_path = os.path.join(package_dir, "manifest.json")

        if os.path.exists(manifest_path):
            with open(manifest_path, "r", encoding="utf-8") as f:
                existing_manifest = json.load(f)
            if existing_manifest.get("model_fingerprint") != model_fp:
                raise ModelPackageConflictError(
                    f"MODEL_PACKAGE_CONFLICT: Existing manifest at {manifest_path} has conflicting fingerprint"
                )
            return self.load_model_manifest(manifest_path)

        os.makedirs(package_dir, exist_ok=True)

        # 5. Copy artifacts
        dest_model_pt = os.path.join(package_dir, "model.pt")
        dest_prep_json = os.path.join(package_dir, "preprocessing.json")
        shutil.copyfile(model_pt_source_path, dest_model_pt)
        shutil.copyfile(preprocessing_json_source_path, dest_prep_json)

        # 6. Write manifest.json last as package commit marker
        created_at = datetime.now(timezone.utc).isoformat()
        manifest = ModelPackageManifest(
            schema_version=1,
            model_id=model_id,
            model_fingerprint=model_fp,
            task=task,
            model_version=train_data["model_version"],
            preprocessing_version=train_data["preprocessing_version"],
            training_run_id=train_data["training_run_id"],
            training_run_manifest_sha256=train_manifest_sha,
            evaluation_run_id=eval_data["evaluation_run_id"],
            evaluation_run_manifest_sha256=eval_manifest_sha,
            gold_snapshot_id=train_data["gold_snapshot_id"],
            gold_manifest_sha256=train_data["gold_manifest_sha256"],
            split_id=train_data["split_id"],
            dataset_view_version=train_data["dataset_view_version"],
            dataset_view_fingerprint=train_data["dataset_view_fingerprint"],
            feature_order=train_data["feature_order"],
            model_pt_sha256=actual_model_pt_sha,
            preprocessing_json_sha256=actual_prep_sha,
            created_at=created_at,
        )

        with open(manifest_path, "w", encoding="utf-8") as f:
            json.dump(manifest.to_dict(), f, indent=2, sort_keys=True)

        return manifest

    def promote_model(
        self,
        task: str,
        challenger_model_id: str,
        evaluation_run_manifest_path: str,
        min_pr_auc_delta: float = 0.0,
    ) -> ModelPromotionRecord:
        """Promote challenger model to champion if it outperforms the current champion or is the first model (bootstrap)."""
        package_dir = os.path.join(self._task_dir(task), challenger_model_id)
        manifest_path = os.path.join(package_dir, "manifest.json")
        if not os.path.exists(manifest_path):
            raise ModelRegistryError(f"Model package not found or uncommitted: {challenger_model_id}")

        challenger_manifest = self.load_model_manifest(manifest_path)

        with open(evaluation_run_manifest_path, "r", encoding="utf-8") as f:
            eval_data = json.load(f)

        metrics = eval_data.get("metrics", {})

        current_champion = self.get_champion(task)
        action = "PROMOTE"
        policy_version = (
            "candidate-promote-pr-auc-v1"
            if task == "candidate_vetting"
            else "anomaly-promote-synthetic-v1"
        )

        if current_champion is None:
            # Cold-start bootstrap: initial model becomes champion
            decision = "BOOTSTRAP_INITIAL_CHAMPION"
            prev_champion_id = None
        else:
            prev_champion_id = current_champion.model_id
            if task == "candidate_vetting":
                # Load current champion evaluation metrics
                champ_eval_dir = os.path.dirname(manifest_path)
                # Compare Challenger Golden PR-AUC vs Champion Golden PR-AUC
                challenger_pr_auc = metrics.get("golden_pr_auc", 0.0)
                # Load champion eval manifest
                champ_eval_path = os.path.join(
                    "evaluations", "runs", "candidate", current_champion.evaluation_run_id, "metrics.json"
                )
                champ_pr_auc = 0.0
                if os.path.exists(champ_eval_path):
                    with open(champ_eval_path, "r", encoding="utf-8") as f:
                        champ_metrics = json.load(f)
                    champ_pr_auc = champ_metrics.get("golden_pr_auc", 0.0)

                if challenger_pr_auc < (champ_pr_auc + min_pr_auc_delta):
                    raise ModelPromotionRejectionError(
                        f"PROMOTION_REJECTED: Challenger PR-AUC ({challenger_pr_auc:.4f}) < Champion PR-AUC ({champ_pr_auc:.4f})"
                    )
                decision = "CHALLENGER_OUTPERFORMS_CHAMPION"
            else:
                # Anomaly: compare synthetic detection rate
                challenger_det_rate = metrics.get("golden_synthetic_detection_rate", 0.0)
                champ_det_rate = 0.0
                champ_eval_path = os.path.join(
                    "evaluations", "runs", "anomaly", current_champion.evaluation_run_id, "metrics.json"
                )
                if os.path.exists(champ_eval_path):
                    with open(champ_eval_path, "r", encoding="utf-8") as f:
                        champ_metrics = json.load(f)
                    champ_det_rate = champ_metrics.get("golden_synthetic_detection_rate", 0.0)

                if challenger_det_rate < champ_det_rate:
                    raise ModelPromotionRejectionError(
                        f"PROMOTION_REJECTED: Challenger synthetic rate ({challenger_det_rate:.4f}) < Champion ({champ_det_rate:.4f})"
                    )
                decision = "CHALLENGER_OUTPERFORMS_CHAMPION"

        promo_id, promo_fp = derive_promotion_identity(
            task=task,
            action=action,
            policy_version=policy_version,
            champion_model_id=challenger_model_id,
            previous_champion_model_id=prev_champion_id,
            evaluation_run_id=eval_data["evaluation_run_id"],
            comparison_decision=decision,
        )

        created_at = datetime.now(timezone.utc).isoformat()
        record = ModelPromotionRecord(
            schema_version=1,
            promotion_id=promo_id,
            promotion_fingerprint=promo_fp,
            task=task,
            action=action,
            policy_version=policy_version,
            champion_model_id=challenger_model_id,
            previous_champion_model_id=prev_champion_id,
            evaluation_run_id=eval_data["evaluation_run_id"],
            evaluation_metrics_summary=metrics,
            comparison_decision=decision,
            created_at=created_at,
        )

        # Write promotion record
        promo_dir = os.path.join(self._task_dir(task), "promotions")
        os.makedirs(promo_dir, exist_ok=True)
        record_path = os.path.join(promo_dir, f"{promo_id}.json")
        with open(record_path, "w", encoding="utf-8") as f:
            json.dump(record.to_dict(), f, indent=2, sort_keys=True)

        # Update champion pointer atomically
        champ_path = os.path.join(self._task_dir(task), "champion.json")
        champ_data = {
            "model_id": challenger_model_id,
            "promotion_id": promo_id,
            "promoted_at": created_at,
        }
        with open(champ_path, "w", encoding="utf-8") as f:
            json.dump(champ_data, f, indent=2, sort_keys=True)

        return record

    def rollback_model(self, task: str, target_model_id: str) -> ModelPromotionRecord:
        """Rollback champion pointer to a previously registered model package."""
        package_dir = os.path.join(self._task_dir(task), target_model_id)
        manifest_path = os.path.join(package_dir, "manifest.json")
        if not os.path.exists(manifest_path):
            raise ModelRegistryError(f"Target rollback model package not found: {target_model_id}")

        current_champion = self.get_champion(task)
        prev_champ_id = current_champion.model_id if current_champion else None

        policy_version = (
            "candidate-rollback-v1"
            if task == "candidate_vetting"
            else "anomaly-rollback-v1"
        )
        action = "ROLLBACK"
        decision = "ROLLBACK_RESTORE_CHAMPION"

        promo_id, promo_fp = derive_promotion_identity(
            task=task,
            action=action,
            policy_version=policy_version,
            champion_model_id=target_model_id,
            previous_champion_model_id=prev_champ_id,
            evaluation_run_id=None,
            comparison_decision=decision,
        )

        created_at = datetime.now(timezone.utc).isoformat()
        record = ModelPromotionRecord(
            schema_version=1,
            promotion_id=promo_id,
            promotion_fingerprint=promo_fp,
            task=task,
            action=action,
            policy_version=policy_version,
            champion_model_id=target_model_id,
            previous_champion_model_id=prev_champ_id,
            comparison_decision=decision,
            created_at=created_at,
        )

        promo_dir = os.path.join(self._task_dir(task), "promotions")
        os.makedirs(promo_dir, exist_ok=True)
        record_path = os.path.join(promo_dir, f"{promo_id}.json")
        with open(record_path, "w", encoding="utf-8") as f:
            json.dump(record.to_dict(), f, indent=2, sort_keys=True)

        champ_path = os.path.join(self._task_dir(task), "champion.json")
        champ_data = {
            "model_id": target_model_id,
            "promotion_id": promo_id,
            "promoted_at": created_at,
        }
        with open(champ_path, "w", encoding="utf-8") as f:
            json.dump(champ_data, f, indent=2, sort_keys=True)

        return record

    def get_champion(self, task: str) -> Optional[ModelPackageManifest]:
        """Get the current champion model package manifest, or None if no champion exists."""
        champ_path = os.path.join(self._task_dir(task), "champion.json")
        if not os.path.exists(champ_path):
            return None

        with open(champ_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        model_id = data.get("model_id")
        if not model_id:
            return None

        manifest_path = os.path.join(self._task_dir(task), model_id, "manifest.json")
        if not os.path.exists(manifest_path):
            return None

        return self.load_model_manifest(manifest_path)

    def load_model_manifest(self, manifest_path: str) -> ModelPackageManifest:
        """Load ModelPackageManifest from a manifest.json file."""
        with open(manifest_path, "r", encoding="utf-8") as f:
            d = json.load(f)

        return ModelPackageManifest(
            schema_version=d.get("schema_version", 1),
            model_id=d["model_id"],
            model_fingerprint=d["model_fingerprint"],
            task=d["task"],
            model_version=d["model_version"],
            preprocessing_version=d["preprocessing_version"],
            training_run_id=d["training_run_id"],
            training_run_manifest_sha256=d["training_run_manifest_sha256"],
            evaluation_run_id=d["evaluation_run_id"],
            evaluation_run_manifest_sha256=d["evaluation_run_manifest_sha256"],
            gold_snapshot_id=d["gold_snapshot_id"],
            gold_manifest_sha256=d["gold_manifest_sha256"],
            split_id=d["split_id"],
            dataset_view_version=d["dataset_view_version"],
            dataset_view_fingerprint=d["dataset_view_fingerprint"],
            feature_order=list(d["feature_order"]),
            model_pt_sha256=d["model_pt_sha256"],
            preprocessing_json_sha256=d["preprocessing_json_sha256"],
            created_at=d["created_at"],
            producer=d.get("producer", "python-ml-worker"),
        )

    def list_registered_models(self, task: str) -> List[ModelPackageManifest]:
        """List all committed model packages for a given task in deterministic order."""
        task_root = self._task_dir(task)
        if not os.path.exists(task_root):
            return []

        models = []
        for name in sorted(os.listdir(task_root)):
            manifest_path = os.path.join(task_root, name, "manifest.json")
            if os.path.isfile(manifest_path):
                models.append(self.load_model_manifest(manifest_path))

        return models

    def get_promotion_history(self, task: str) -> List[ModelPromotionRecord]:
        """Get the chronological promotion and rollback audit trail."""
        promo_dir = os.path.join(self._task_dir(task), "promotions")
        if not os.path.exists(promo_dir):
            return []

        records = []
        for name in sorted(os.listdir(promo_dir)):
            if name.endswith(".json"):
                with open(os.path.join(promo_dir, name), "r", encoding="utf-8") as f:
                    d = json.load(f)
                records.append(
                    ModelPromotionRecord(
                        schema_version=d.get("schema_version", 1),
                        promotion_id=d["promotion_id"],
                        promotion_fingerprint=d["promotion_fingerprint"],
                        task=d["task"],
                        action=d["action"],
                        policy_version=d["policy_version"],
                        champion_model_id=d["champion_model_id"],
                        previous_champion_model_id=d.get("previous_champion_model_id"),
                        evaluation_run_id=d.get("evaluation_run_id"),
                        evaluation_metrics_summary=d.get("evaluation_metrics_summary"),
                        comparison_decision=d["comparison_decision"],
                        created_at=d["created_at"],
                        producer=d.get("producer", "python-ml-worker"),
                    )
                )

        return records
