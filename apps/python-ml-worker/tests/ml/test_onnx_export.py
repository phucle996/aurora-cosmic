"""Unit and Integration Tests for ONNX Runtime Export & Python Parity (Phase 6.6).

Verifies ONNX opset 17 export, structural model checks, numerical parity
tolerance (|error| <= 1e-5), parity fixture generation, and immutable
model-runtime-v1 package materialization.
"""

import json
import os
import tempfile
from typing import Any, Dict, List, Tuple

import numpy as np
import pytest
import torch

from aurora_ml.export_onnx import (
    ModelRuntimeManifest,
    OnnxExportError,
    OnnxParityError,
    RuntimeExporter,
)
from aurora_ml.ml.candidate.model import CandidateTabularMlpV1, CANDIDATE_MODEL_INPUT_FEATURES
from aurora_ml.ml.candidate.preprocessor import CandidatePreprocessor
from aurora_ml.ml.anomaly.model import AnomalyAutoencoderV1, ANOMALY_MODEL_INPUT_FEATURES
from aurora_ml.ml.anomaly.preprocessor import AnomalyPreprocessor
from aurora_ml.ml.registry import ModelRegistry


def setup_test_candidate_registered_model(root_dir: str) -> Tuple[str, str, List[Dict[str, Any]]]:
    """Helper to set up a registered candidate model package and evaluation run."""
    import hashlib
    registry_root = os.path.join(root_dir, "models")
    eval_root = os.path.join(root_dir, "evaluations", "runs", "candidate")
    os.makedirs(registry_root, exist_ok=True)
    os.makedirs(eval_root, exist_ok=True)

    # 1. Create native PyTorch candidate model
    model = CandidateTabularMlpV1(input_dim=len(CANDIDATE_MODEL_INPUT_FEATURES))
    model_pt = os.path.join(root_dir, "model.pt")
    torch.save(model.state_dict(), model_pt)
    model_sha = hashlib.sha256(open(model_pt, "rb").read()).hexdigest()

    # 2. Fit preprocessor
    sample_rows = []
    for i in range(16):
        row = {f: 1.0 + i * 0.1 for f in CANDIDATE_MODEL_INPUT_FEATURES}
        sample_rows.append(row)

    prep = CandidatePreprocessor.fit(sample_rows, CANDIDATE_MODEL_INPUT_FEATURES, "split-cand-v1")
    prep_json = os.path.join(root_dir, "preprocessing.json")
    with open(prep_json, "w", encoding="utf-8") as f:
        json.dump(prep.to_dict(), f)
    prep_sha = hashlib.sha256(open(prep_json, "rb").read()).hexdigest()

    # 3. Create training run manifest
    train_manifest = os.path.join(root_dir, "train_manifest.json")
    with open(train_manifest, "w", encoding="utf-8") as f:
        json.dump({
            "schema_version": 1,
            "training_run_id": "run-cand-v1-test123",
            "training_spec_fingerprint": "f" * 64,
            "task": "candidate_vetting",
            "model_version": "candidate-tabular-mlp-v1",
            "gold_snapshot_id": "gold-v1-test123",
            "gold_manifest_sha256": "g" * 64,
            "split_id": "split-cand-v1",
            "split_manifest_sha256": "s" * 64,
            "dataset_view_version": "candidate-ml-view-v1",
            "dataset_view_fingerprint": "v" * 64,
            "feature_order": list(CANDIDATE_MODEL_INPUT_FEATURES),
            "preprocessing_version": "candidate-preprocess-v1",
            "preprocessing_sha256": prep_sha,
            "training_seed": 42,
            "hyperparameters": {},
            "train_row_count": 10,
            "validation_row_count": 6,
            "best_epoch": 10,
            "best_validation_loss": 0.05,
            "model_sha256": model_sha,
            "metrics_sha256": "m" * 64,
            "created_at": "2026-08-08T00:00:00Z",
        }, f)

    # 4. Create evaluation run manifest & threshold
    eval_run_id = "eval-cand-v1-test123"
    eval_run_dir = os.path.join(eval_root, eval_run_id)
    os.makedirs(eval_run_dir, exist_ok=True)
    eval_manifest = os.path.join(eval_run_dir, "manifest.json")
    with open(eval_manifest, "w", encoding="utf-8") as f:
        json.dump({
            "schema_version": 1,
            "evaluation_run_id": eval_run_id,
            "evaluation_spec_fingerprint": "e" * 64,
            "task": "candidate_vetting",
            "training_run_id": "run-cand-v1-test123",
            "training_run_manifest_sha256": "t" * 64,
            "model_version": "candidate-tabular-mlp-v1",
            "model_sha256": model_sha,
            "preprocessing_version": "candidate-preprocess-v1",
            "preprocessing_sha256": prep_sha,
            "golden_cohort_id": "cohort-gold-123",
            "golden_cohort_manifest_sha256": "c" * 64,
            "evaluation_policy_version": "candidate-evaluation-v1",
            "threshold_policy_version": "candidate-threshold-max-f1-v1",
            "decision_threshold": 0.45,
            "metrics": {"golden_pr_auc": 0.88},
            "created_at": "2026-08-08T00:00:00Z",
        }, f)

    with open(os.path.join(eval_run_dir, "threshold.json"), "w", encoding="utf-8") as f:
        json.dump({"decision_threshold": 0.45}, f)

    # 5. Register model package
    registry = ModelRegistry(registry_root)
    pkg = registry.register_model_package(
        task="candidate_vetting",
        training_run_manifest_path=train_manifest,
        evaluation_run_manifest_path=eval_manifest,
        model_pt_source_path=model_pt,
        preprocessing_json_source_path=prep_json,
    )

    return pkg.model_id, eval_manifest, sample_rows


def test_candidate_onnx_export_and_python_parity():
    """Verify Candidate model export to ONNX opset 17 and Python native vs ORT parity."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        model_id, eval_manifest_path, sample_rows = setup_test_candidate_registered_model(tmp_dir)

        exporter = RuntimeExporter(
            registry_root=os.path.join(tmp_dir, "models"),
            runtime_root=os.path.join(tmp_dir, "models", "runtime"),
        )

        manifest = exporter.export_candidate_runtime_package(
            model_id=model_id,
            evaluation_run_manifest_path=eval_manifest_path,
            validation_rows=sample_rows,
        )

        assert isinstance(manifest, ModelRuntimeManifest)
        assert manifest.task == "candidate_vetting"
        assert manifest.onnx_opset == 17
        assert manifest.python_parity_status == "PASS"
        assert manifest.decision_threshold == 0.45

        # Verify package directory structure
        runtime_pkg_dir = os.path.join(tmp_dir, "models", "runtime", "candidate", manifest.runtime_package_id)
        assert os.path.exists(os.path.join(runtime_pkg_dir, "model.onnx"))
        assert os.path.exists(os.path.join(runtime_pkg_dir, "preprocessing.json"))
        assert os.path.exists(os.path.join(runtime_pkg_dir, "threshold.json"))
        assert os.path.exists(os.path.join(runtime_pkg_dir, "parity-fixture.json"))
        assert os.path.exists(os.path.join(runtime_pkg_dir, "manifest.json"))


def test_anomaly_onnx_export_and_python_parity():
    """Verify Anomaly model export to ONNX opset 17 and reconstruction parity."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        import hashlib
        registry_root = os.path.join(tmp_dir, "models")
        eval_root = os.path.join(tmp_dir, "evaluations", "runs", "anomaly")
        os.makedirs(registry_root, exist_ok=True)
        os.makedirs(eval_root, exist_ok=True)

        # 1. Create native PyTorch anomaly autoencoder
        model = AnomalyAutoencoderV1(input_dim=len(ANOMALY_MODEL_INPUT_FEATURES))
        model_pt = os.path.join(tmp_dir, "model_anom.pt")
        torch.save(model.state_dict(), model_pt)
        model_sha = hashlib.sha256(open(model_pt, "rb").read()).hexdigest()

        # 2. Fit preprocessor
        sample_rows = []
        for i in range(16):
            row = {f: 0.2 + i * 0.05 for f in ANOMALY_MODEL_INPUT_FEATURES}
            sample_rows.append(row)

        prep = AnomalyPreprocessor.fit(sample_rows, ANOMALY_MODEL_INPUT_FEATURES, "split-anom-v1")
        prep_json = os.path.join(tmp_dir, "preprocessing_anom.json")
        with open(prep_json, "w", encoding="utf-8") as f:
            json.dump(prep.to_dict(), f)
        prep_sha = hashlib.sha256(open(prep_json, "rb").read()).hexdigest()

        # 3. Create training run manifest
        train_manifest = os.path.join(tmp_dir, "train_anom_manifest.json")
        with open(train_manifest, "w", encoding="utf-8") as f:
            json.dump({
                "schema_version": 1,
                "training_run_id": "run-anom-v1-test123",
                "training_spec_fingerprint": "f" * 64,
                "task": "astronomical_anomaly_detection",
                "model_version": "anomaly-lightcurve-autoencoder-v1",
                "gold_snapshot_id": "gold-v1-anom123",
                "gold_manifest_sha256": "g" * 64,
                "split_id": "split-anom-v1",
                "split_manifest_sha256": "s" * 64,
                "dataset_view_version": "anomaly-lightcurve-ml-view-v1",
                "dataset_view_fingerprint": "v" * 64,
                "feature_order": list(ANOMALY_MODEL_INPUT_FEATURES),
                "preprocessing_version": "anomaly-lightcurve-preprocess-v1",
                "preprocessing_sha256": prep_sha,
                "training_seed": 42,
                "hyperparameters": {},
                "train_row_count": 10,
                "validation_row_count": 6,
                "best_epoch": 10,
                "best_validation_loss": 0.01,
                "model_sha256": model_sha,
                "metrics_sha256": "m" * 64,
                "created_at": "2026-08-08T00:00:00Z",
            }, f)

        eval_run_id = "eval-anom-v1-test123"
        eval_run_dir = os.path.join(eval_root, eval_run_id)
        os.makedirs(eval_run_dir, exist_ok=True)
        eval_manifest = os.path.join(eval_run_dir, "manifest.json")
        with open(eval_manifest, "w", encoding="utf-8") as f:
            json.dump({
                "schema_version": 1,
                "evaluation_run_id": eval_run_id,
                "evaluation_spec_fingerprint": "e" * 64,
                "task": "astronomical_anomaly_detection",
                "training_run_id": "run-anom-v1-test123",
                "training_run_manifest_sha256": "t" * 64,
                "model_version": "anomaly-lightcurve-autoencoder-v1",
                "model_sha256": model_sha,
                "preprocessing_version": "anomaly-lightcurve-preprocess-v1",
                "preprocessing_sha256": prep_sha,
                "golden_cohort_id": "cohort-gold-anom123",
                "golden_cohort_manifest_sha256": "c" * 64,
                "evaluation_policy_version": "anomaly-evaluation-v1",
                "threshold_policy_version": "anomaly-threshold-validation-p99-v1",
                "decision_threshold": 0.08,
                "metrics": {"golden_synthetic_detection_rate": 0.96},
                "created_at": "2026-08-08T00:00:00Z",
            }, f)

        with open(os.path.join(eval_run_dir, "threshold.json"), "w", encoding="utf-8") as f:
            json.dump({"decision_threshold": 0.08}, f)

        registry = ModelRegistry(registry_root)
        pkg = registry.register_model_package(
            task="astronomical_anomaly_detection",
            training_run_manifest_path=train_manifest,
            evaluation_run_manifest_path=eval_manifest,
            model_pt_source_path=model_pt,
            preprocessing_json_source_path=prep_json,
        )

        exporter = RuntimeExporter(
            registry_root=registry_root,
            runtime_root=os.path.join(tmp_dir, "models", "runtime"),
        )

        manifest = exporter.export_anomaly_runtime_package(
            model_id=pkg.model_id,
            evaluation_run_manifest_path=eval_manifest,
            validation_rows=sample_rows,
        )

        assert isinstance(manifest, ModelRuntimeManifest)
        assert manifest.task == "astronomical_anomaly_detection"
        assert manifest.onnx_output_name == "reconstruction"
        assert manifest.python_parity_status == "PASS"
        assert manifest.decision_threshold == 0.08
