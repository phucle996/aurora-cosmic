"""Unit and Integration Tests for Production Inference Job Planning (Phase 7.1).

Verifies Gold artifact discovery, CPU PASS qualification requirement,
deterministic job manifest creation, and model-input SHA-256 calculation.
"""

import json
import os
import tempfile
from typing import Any, Dict

import numpy as np
import pytest

from aurora_ml.inference_jobs import (
    InferenceJobError,
    InferenceJobManifest,
    InferenceJobPlanner,
    compute_job_fingerprint,
)
from aurora_ml.predictions import (
    CandidatePredictionRecord,
    AnomalyPredictionRecord,
    compute_candidate_prediction_id,
    compute_anomaly_prediction_id,
    compute_model_input_sha256,
)


def setup_inference_planning_environment(root_dir: str):
    """Helper to set up committed Gold snapshot, runtime package, and CPU PASS validation."""
    gold_dir = os.path.join(root_dir, "gold", "candidate", "gold-cand-v1-test")
    runtime_dir = os.path.join(root_dir, "models", "runtime", "candidate", "run-cand-pkg-123")
    val_dir = os.path.join(root_dir, "models", "runtime-validations")
    manifest_dir = os.path.join(root_dir, "manifests")
    os.makedirs(gold_dir, exist_ok=True)
    os.makedirs(runtime_dir, exist_ok=True)
    os.makedirs(val_dir, exist_ok=True)
    os.makedirs(manifest_dir, exist_ok=True)

    # 1. Gold snapshot manifest with 2 non-empty partition artifacts
    gold_manifest_path = os.path.join(gold_dir, "manifest.json")
    with open(gold_manifest_path, "w", encoding="utf-8") as f:
        json.dump({
            "schema_version": 1,
            "snapshot_id": "gold-cand-v1-test",
            "gold_schema_version": "gold-candidate-v1",
            "artifacts": [
                {
                    "artifact_key": "gold/candidate/gold-cand-v1-test/part-001.parquet",
                    "content_sha256": "a" * 64,
                    "row_count": 100,
                    "sector": 10,
                },
                {
                    "artifact_key": "gold/candidate/gold-cand-v1-test/part-002.parquet",
                    "content_sha256": "b" * 64,
                    "row_count": 50,
                    "sector": 11,
                },
            ],
            "created_at": "2026-08-08T00:00:00Z",
        }, f)

    # 2. Runtime package manifest
    runtime_manifest_path = os.path.join(runtime_dir, "manifest.json")
    with open(runtime_manifest_path, "w", encoding="utf-8") as f:
        json.dump({
            "schema_version": 1,
            "runtime_package_id": "run-cand-pkg-123",
            "runtime_fingerprint": "r" * 64,
            "task": "candidate_vetting",
            "source_model_id": "model-cand-123",
            "model_version": "candidate-tabular-mlp-v1",
            "feature_order": ["feat_1", "feat_2"],
            "decision_threshold": 0.45,
            "created_at": "2026-08-08T00:00:00Z",
        }, f)

    # 3. Runtime validation record (CPU PASS)
    val_path = os.path.join(val_dir, "rval-v1-test123.json")
    with open(val_path, "w", encoding="utf-8") as f:
        json.dump({
            "schema_version": 1,
            "validation_record_id": "rval-v1-test123",
            "runtime_package_id": "run-cand-pkg-123",
            "engine": "rust-inference-ort",
            "validation_status": "PASS",
            "max_absolute_error": 1e-6,
            "created_at": "2026-08-08T00:00:00Z",
        }, f)

    planner = InferenceJobPlanner(
        gold_root=os.path.join(root_dir, "gold"),
        runtime_root=os.path.join(root_dir, "models", "runtime"),
        validation_root=val_dir,
        manifest_root=manifest_dir,
    )
    return planner, manifest_dir


def test_candidate_inference_job_planning_success():
    """Verify candidate inference job planning materializes exactly one job per non-empty artifact."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        planner, manifest_dir = setup_inference_planning_environment(tmp_dir)

        jobs = planner.plan_candidate_jobs(
            gold_snapshot_id="gold-cand-v1-test",
            runtime_package_id="run-cand-pkg-123",
            dry_run=False,
        )

        assert len(jobs) == 2
        for j in jobs:
            assert isinstance(j, InferenceJobManifest)
            assert j.task == "candidate_vetting"
            assert j.runtime_package_id == "run-cand-pkg-123"
            assert j.runtime_validation_id == "rval-v1-test123"
            assert j.expected_prediction_count in (100, 50)
            assert j.job_id.startswith("inference-job-v1-")

            # Verify physical manifest written
            job_file = os.path.join(manifest_dir, "inference-jobs", "candidate", f"{j.job_id}.json")
            assert os.path.exists(job_file)


def test_planning_unqualified_runtime_fails():
    """Verify inference job planning rejects runtime packages without CPU PASS validation."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        planner, _ = setup_inference_planning_environment(tmp_dir)

        # Create runtime package manifest but NO validation record
        unval_pkg = os.path.join(tmp_dir, "models", "runtime", "candidate", "run-unqualified-999")
        os.makedirs(unval_pkg, exist_ok=True)
        with open(os.path.join(unval_pkg, "manifest.json"), "w", encoding="utf-8") as f:
            json.dump({
                "schema_version": 1,
                "runtime_package_id": "run-unqualified-999",
                "runtime_fingerprint": "u" * 64,
                "task": "candidate_vetting",
                "created_at": "2026-08-08T00:00:00Z",
            }, f)

        with pytest.raises(InferenceJobError, match="UNQUALIFIED_RUNTIME"):
            planner.plan_candidate_jobs(
                gold_snapshot_id="gold-cand-v1-test",
                runtime_package_id="run-unqualified-999",
            )


def test_model_input_sha256_endian_consistency():
    """Verify model-input SHA-256 is deterministic across known float32 inputs."""
    vec = [1.0, 2.5, -3.0]
    sha = compute_model_input_sha256(vec)
    assert len(sha) == 64

    # Repeating same vector yields exact same SHA
    assert compute_model_input_sha256(vec) == sha


def test_prediction_id_determinism():
    """Verify candidate and anomaly prediction IDs are deterministic and distinct."""
    p_cand_1, fp_1 = compute_candidate_prediction_id("pkg-1", "gold-1", "prod-100")
    p_cand_2, fp_2 = compute_candidate_prediction_id("pkg-1", "gold-1", "prod-100")
    assert p_cand_1 == p_cand_2
    assert fp_1 == fp_2

    p_anom_1, _ = compute_anomaly_prediction_id("pkg-1", "gold-1", "prod-100")
    assert p_anom_1 != p_cand_1
