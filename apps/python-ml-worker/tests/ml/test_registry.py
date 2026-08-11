"""Unit and Integration Tests for Model Registry, Promotion & Rollback (Phase 6.5).

Tests model package registration, integrity checks, champion bootstrap,
challenger promotion against Golden PR-AUC / synthetic detection rate,
and safe rollback.
"""

import json
import os
import tempfile
from typing import Any, Dict

import pytest

from aurora_ml.ml.registry import (
    ModelPackageIntegrityError,
    ModelPackageManifest,
    ModelPromotionRecord,
    ModelPromotionRejectionError,
    ModelRegistry,
)


def sample_training_manifest_dict(
    task: str = "candidate_vetting",
    model_sha: str = "m" * 64,
    prep_sha: str = "p" * 64,
) -> Dict[str, Any]:
    prefix = "cand" if task == "candidate_vetting" else "anom"
    model_v = (
        "candidate-tabular-mlp-v1"
        if task == "candidate_vetting"
        else "anomaly-lightcurve-autoencoder-v1"
    )
    prep_v = (
        "candidate-preprocess-v1"
        if task == "candidate_vetting"
        else "anomaly-lightcurve-preprocess-v1"
    )

    return {
        "schema_version": 1,
        "training_run_id": f"run-{prefix}-v1-test123",
        "training_spec_fingerprint": "f" * 64,
        "task": task,
        "model_version": model_v,
        "gold_snapshot_id": "gold-v1-test123",
        "gold_manifest_sha256": "g" * 64,
        "split_id": "split-v1-test123",
        "split_manifest_sha256": "s" * 64,
        "dataset_view_version": f"{prefix}-ml-view-v1",
        "dataset_view_fingerprint": "v" * 64,
        "feature_order": ["f1", "f2", "f3"],
        "preprocessing_version": prep_v,
        "preprocessing_sha256": prep_sha,
        "training_seed": 42,
        "hyperparameters": {},
        "train_row_count": 10,
        "validation_row_count": 5,
        "best_epoch": 10,
        "best_validation_loss": 0.05,
        "model_sha256": model_sha,
        "metrics_sha256": "met" * 21 + "m",
        "created_at": "2026-08-08T00:00:00Z",
    }


def sample_eval_manifest_dict(
    task: str = "candidate_vetting",
    golden_pr_auc: float = 0.85,
    golden_synthetic_rate: float = 0.95,
) -> Dict[str, Any]:
    prefix = "cand" if task == "candidate_vetting" else "anom"
    metrics = (
        {"golden_pr_auc": golden_pr_auc, "golden_roc_auc": 0.90, "golden_recall": 0.80}
        if task == "candidate_vetting"
        else {
            "golden_synthetic_detection_rate": golden_synthetic_rate,
            "golden_reference_alert_rate": 0.01,
        }
    )

    return {
        "schema_version": 1,
        "evaluation_run_id": f"eval-{prefix}-v1-test123",
        "evaluation_spec_fingerprint": "e" * 64,
        "task": task,
        "training_run_id": f"run-{prefix}-v1-test123",
        "training_run_manifest_sha256": "t" * 64,
        "model_version": f"{prefix}-v1",
        "model_sha256": "m" * 64,
        "preprocessing_version": f"{prefix}-prep-v1",
        "preprocessing_sha256": "p" * 64,
        "golden_cohort_id": f"cohort-{prefix}-gold-v1-123",
        "golden_cohort_manifest_sha256": "c" * 64,
        "evaluation_policy_version": f"{prefix}-evaluation-v1",
        "threshold_policy_version": f"{prefix}-threshold-v1",
        "decision_threshold": 0.5,
        "threshold_sha256": "th" * 32,
        "metrics_sha256": "me" * 32,
        "metrics": metrics,
        "created_at": "2026-08-08T00:00:00Z",
    }


# -----------------------------------------------------------------------------
# Unit Tests: Model Package Registration & Integrity
# -----------------------------------------------------------------------------


def test_model_package_registration_and_manifest_commit_marker():
    """Verify register_model_package copies artifacts and commits manifest.json last."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        registry_root = os.path.join(tmp_dir, "models")
        registry = ModelRegistry(registry_root=registry_root)

        # Create dummy artifacts
        model_pt = os.path.join(tmp_dir, "model.pt")
        with open(model_pt, "wb") as f:
            f.write(b"model_weights_data_12345")
        import hashlib

        model_sha = hashlib.sha256(b"model_weights_data_12345").hexdigest()

        prep_json = os.path.join(tmp_dir, "preprocessing.json")
        with open(prep_json, "wb") as f:
            f.write(b'{"mean": 0.5}')
        prep_sha = hashlib.sha256(b'{"mean": 0.5}').hexdigest()

        train_manifest = os.path.join(tmp_dir, "train_manifest.json")
        with open(train_manifest, "w", encoding="utf-8") as f:
            json.dump(
                sample_training_manifest_dict(model_sha=model_sha, prep_sha=prep_sha), f
            )

        eval_manifest = os.path.join(tmp_dir, "eval_manifest.json")
        with open(eval_manifest, "w", encoding="utf-8") as f:
            json.dump(sample_eval_manifest_dict(), f)

        # Register model package
        pkg = registry.register_model_package(
            task="candidate_vetting",
            training_run_manifest_path=train_manifest,
            evaluation_run_manifest_path=eval_manifest,
            model_pt_source_path=model_pt,
            preprocessing_json_source_path=prep_json,
        )

        assert isinstance(pkg, ModelPackageManifest)
        assert pkg.task == "candidate_vetting"
        assert pkg.model_pt_sha256 == model_sha
        assert pkg.preprocessing_json_sha256 == prep_sha

        # Verify package directory structure
        pkg_dir = os.path.join(registry_root, "candidate", pkg.model_id)
        assert os.path.exists(os.path.join(pkg_dir, "model.pt"))
        assert os.path.exists(os.path.join(pkg_dir, "preprocessing.json"))
        assert os.path.exists(os.path.join(pkg_dir, "manifest.json"))


def test_corrupt_model_artifact_rejection():
    """Verify register_model_package rejects corrupted model.pt with ModelPackageIntegrityError."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        registry = ModelRegistry(registry_root=os.path.join(tmp_dir, "models"))

        model_pt = os.path.join(tmp_dir, "model.pt")
        with open(model_pt, "wb") as f:
            f.write(b"actual_data")

        prep_json = os.path.join(tmp_dir, "preprocessing.json")
        with open(prep_json, "wb") as f:
            f.write(b"{}")
        import hashlib

        prep_sha = hashlib.sha256(b"{}").hexdigest()

        # Training manifest points to a DIFFERENT expected model SHA
        train_manifest = os.path.join(tmp_dir, "train_manifest.json")
        with open(train_manifest, "w", encoding="utf-8") as f:
            json.dump(
                sample_training_manifest_dict(
                    model_sha="wrong_sha" * 8, prep_sha=prep_sha
                ),
                f,
            )

        eval_manifest = os.path.join(tmp_dir, "eval_manifest.json")
        with open(eval_manifest, "w", encoding="utf-8") as f:
            json.dump(sample_eval_manifest_dict(), f)

        with pytest.raises(ModelPackageIntegrityError, match="MODEL_SHA_MISMATCH"):
            registry.register_model_package(
                task="candidate_vetting",
                training_run_manifest_path=train_manifest,
                evaluation_run_manifest_path=eval_manifest,
                model_pt_source_path=model_pt,
                preprocessing_json_source_path=prep_json,
            )


# -----------------------------------------------------------------------------
# Unit Tests: Champion Bootstrap, Promotion & Rollback
# -----------------------------------------------------------------------------


def test_cold_start_bootstrap_candidate_promotion():
    """Verify first registered model is promoted as initial Champion (cold start bootstrap)."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        registry = ModelRegistry(registry_root=os.path.join(tmp_dir, "models"))

        # Setup model package
        model_pt = os.path.join(tmp_dir, "model.pt")
        with open(model_pt, "wb") as f:
            f.write(b"weights")
        import hashlib

        model_sha = hashlib.sha256(b"weights").hexdigest()

        prep_json = os.path.join(tmp_dir, "preprocessing.json")
        with open(prep_json, "wb") as f:
            f.write(b"{}")
        prep_sha = hashlib.sha256(b"{}").hexdigest()

        train_manifest = os.path.join(tmp_dir, "train_manifest.json")
        with open(train_manifest, "w", encoding="utf-8") as f:
            json.dump(
                sample_training_manifest_dict(model_sha=model_sha, prep_sha=prep_sha), f
            )

        eval_manifest = os.path.join(tmp_dir, "eval_manifest.json")
        with open(eval_manifest, "w", encoding="utf-8") as f:
            json.dump(sample_eval_manifest_dict(golden_pr_auc=0.82), f)

        pkg = registry.register_model_package(
            task="candidate_vetting",
            training_run_manifest_path=train_manifest,
            evaluation_run_manifest_path=eval_manifest,
            model_pt_source_path=model_pt,
            preprocessing_json_source_path=prep_json,
        )

        # Initial promotion
        promo = registry.promote_model(
            task="candidate_vetting",
            challenger_model_id=pkg.model_id,
            evaluation_run_manifest_path=eval_manifest,
        )

        assert isinstance(promo, ModelPromotionRecord)
        assert promo.action == "PROMOTE"
        assert promo.comparison_decision == "BOOTSTRAP_INITIAL_CHAMPION"
        assert promo.previous_champion_model_id is None

        # Check champion pointer
        champ = registry.get_champion("candidate_vetting")
        assert champ is not None
        assert champ.model_id == pkg.model_id


def test_candidate_challenger_promotion_success_and_rejection():
    """Verify challenger with higher Golden PR-AUC succeeds and lower PR-AUC is rejected."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        registry = ModelRegistry(registry_root=os.path.join(tmp_dir, "models"))
        import hashlib

        # 1. Model A (PR-AUC = 0.80) -> Bootstrap Champion
        model_a_pt = os.path.join(tmp_dir, "model_a.pt")
        with open(model_a_pt, "wb") as f:
            f.write(b"model_a")
        sha_a = hashlib.sha256(b"model_a").hexdigest()

        prep_json = os.path.join(tmp_dir, "preprocessing.json")
        with open(prep_json, "wb") as f:
            f.write(b"{}")
        prep_sha = hashlib.sha256(b"{}").hexdigest()

        train_a = os.path.join(tmp_dir, "train_a.json")
        with open(train_a, "w", encoding="utf-8") as f:
            d = sample_training_manifest_dict(model_sha=sha_a, prep_sha=prep_sha)
            d["training_run_id"] = "run-cand-v1-modelA"
            json.dump(d, f)

        eval_a = os.path.join(tmp_dir, "eval_a.json")
        with open(eval_a, "w", encoding="utf-8") as f:
            d = sample_eval_manifest_dict(golden_pr_auc=0.80)
            d["evaluation_run_id"] = "eval-cand-v1-modelA"
            json.dump(d, f)

        # Register & bootstrap Model A
        pkg_a = registry.register_model_package(
            "candidate_vetting", train_a, eval_a, model_a_pt, prep_json
        )

        # Save eval_a metrics in evaluations/runs/candidate/eval-cand-v1-modelA/metrics.json so promote_model can read champion metrics
        champ_eval_dir = os.path.join(
            "evaluations", "runs", "candidate", "eval-cand-v1-modelA"
        )
        os.makedirs(champ_eval_dir, exist_ok=True)
        with open(
            os.path.join(champ_eval_dir, "metrics.json"), "w", encoding="utf-8"
        ) as f:
            json.dump({"golden_pr_auc": 0.80}, f)

        registry.promote_model("candidate_vetting", pkg_a.model_id, eval_a)

        # 2. Model B (PR-AUC = 0.70) -> Should be rejected
        model_b_pt = os.path.join(tmp_dir, "model_b.pt")
        with open(model_b_pt, "wb") as f:
            f.write(b"model_b")
        sha_b = hashlib.sha256(b"model_b").hexdigest()

        train_b = os.path.join(tmp_dir, "train_b.json")
        with open(train_b, "w", encoding="utf-8") as f:
            d = sample_training_manifest_dict(model_sha=sha_b, prep_sha=prep_sha)
            d["training_run_id"] = "run-cand-v1-modelB"
            json.dump(d, f)

        eval_b = os.path.join(tmp_dir, "eval_b.json")
        with open(eval_b, "w", encoding="utf-8") as f:
            d = sample_eval_manifest_dict(golden_pr_auc=0.70)
            d["evaluation_run_id"] = "eval-cand-v1-modelB"
            json.dump(d, f)

        pkg_b = registry.register_model_package(
            "candidate_vetting", train_b, eval_b, model_b_pt, prep_json
        )

        with pytest.raises(ModelPromotionRejectionError, match="PROMOTION_REJECTED"):
            registry.promote_model("candidate_vetting", pkg_b.model_id, eval_b)

        # 3. Model C (PR-AUC = 0.90) -> Should succeed
        model_c_pt = os.path.join(tmp_dir, "model_c.pt")
        with open(model_c_pt, "wb") as f:
            f.write(b"model_c")
        sha_c = hashlib.sha256(b"model_c").hexdigest()

        train_c = os.path.join(tmp_dir, "train_c.json")
        with open(train_c, "w", encoding="utf-8") as f:
            d = sample_training_manifest_dict(model_sha=sha_c, prep_sha=prep_sha)
            d["training_run_id"] = "run-cand-v1-modelC"
            json.dump(d, f)

        eval_c = os.path.join(tmp_dir, "eval_c.json")
        with open(eval_c, "w", encoding="utf-8") as f:
            d = sample_eval_manifest_dict(golden_pr_auc=0.90)
            d["evaluation_run_id"] = "eval-cand-v1-modelC"
            json.dump(d, f)

        pkg_c = registry.register_model_package(
            "candidate_vetting", train_c, eval_c, model_c_pt, prep_json
        )
        promo_c = registry.promote_model("candidate_vetting", pkg_c.model_id, eval_c)

        assert promo_c.comparison_decision == "CHALLENGER_OUTPERFORMS_CHAMPION"
        assert promo_c.champion_model_id == pkg_c.model_id
        assert promo_c.previous_champion_model_id == pkg_a.model_id

        # Verify champion pointer now points to Model C
        assert registry.get_champion("candidate_vetting").model_id == pkg_c.model_id


def test_safe_champion_rollback():
    """Verify rollback sets champion back to previous package and writes rollback audit log."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        registry = ModelRegistry(registry_root=os.path.join(tmp_dir, "models"))
        import hashlib

        # Setup Model A
        model_a = os.path.join(tmp_dir, "model_a.pt")
        with open(model_a, "wb") as f:
            f.write(b"a")
        prep = os.path.join(tmp_dir, "prep.json")
        with open(prep, "wb") as f:
            f.write(b"{}")

        sha_a = hashlib.sha256(b"a").hexdigest()
        prep_sha = hashlib.sha256(b"{}").hexdigest()

        train_a = os.path.join(tmp_dir, "t_a.json")
        with open(train_a, "w", encoding="utf-8") as f:
            json.dump(
                sample_training_manifest_dict(model_sha=sha_a, prep_sha=prep_sha), f
            )
        eval_a = os.path.join(tmp_dir, "e_a.json")
        with open(eval_a, "w", encoding="utf-8") as f:
            json.dump(sample_eval_manifest_dict(), f)

        pkg_a = registry.register_model_package(
            "candidate_vetting", train_a, eval_a, model_a, prep
        )
        registry.promote_model("candidate_vetting", pkg_a.model_id, eval_a)

        # Rollback test
        rollback_record = registry.rollback_model("candidate_vetting", pkg_a.model_id)

        assert rollback_record.action == "ROLLBACK"
        assert rollback_record.champion_model_id == pkg_a.model_id
        assert rollback_record.comparison_decision == "ROLLBACK_RESTORE_CHAMPION"

        history = registry.get_promotion_history("candidate_vetting")
        assert len(history) == 2  # 1 bootstrap promote + 1 rollback
        assert history[-1].action == "ROLLBACK"
