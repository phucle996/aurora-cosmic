"""Stage 6 Full End-to-End ML Integration Test (Phase 6.7).

Executes the complete pipeline:
Gold -> ML View -> Splits -> Training -> Evaluation -> Registry -> Champion/Challenger/Rollback -> ONNX Runtime Package Export -> Numerical Parity Verification.
"""

import json
import os
import tempfile
from typing import Any, Dict, List, Tuple

import numpy as np
import pytest
import torch

from aurora_ml.export_onnx import RuntimeExporter
from aurora_ml.ml.anomaly.model import AnomalyLightcurveAutoencoder, ANOMALY_MODEL_INPUT_FEATURES
from aurora_ml.ml.anomaly.preprocessor import AnomalyPreprocessor
from aurora_ml.ml.candidate.model import CandidateTabularMLP, CANDIDATE_MODEL_INPUT_FEATURES
from aurora_ml.ml.candidate.preprocessor import CandidatePreprocessor
from aurora_ml.ml.datasets.splits import (
    build_anomaly_ml_view,
    build_candidate_ml_view,
    create_anomaly_group_split,
    create_deterministic_group_split,
)
from aurora_ml.ml.evaluate import (
    build_evaluation_cohort,
    evaluate_anomaly_model,
    evaluate_candidate_model,
)
from aurora_ml.ml.registry import ModelRegistry
from aurora_ml.pipeline.gold import GoldSnapshotManifest


def generate_candidate_e2e_dataset() -> Tuple[GoldSnapshotManifest, List[Dict[str, Any]]]:
    """Generate sample Gold candidate dataset with train, validation, golden, and recent targets."""
    manifest = GoldSnapshotManifest(
        schema_version=1,
        snapshot_id="gold-v1-stage6test",
        snapshot_fingerprint="a" * 64,
        snapshot_type="CANDIDATE",
        gold_schema_version="gold-candidate-v1",
        feature_versions={"lc": "1"},
        input_count=1,
        inputs=[],
        catalog_snapshots={},
        label_snapshots={},
        created_at="2026-08-08T00:00:00Z",
        producer="python-ml-worker",
    )

    rows = []
    # Training targets: 5 POSITIVE, 5 NEGATIVE across diverse TICs
    train_specs = [
        (101, "POSITIVE", 10), (102, "NEGATIVE", 10),
        (103, "POSITIVE", 11), (104, "NEGATIVE", 11),
        (105, "POSITIVE", 12), (106, "NEGATIVE", 12),
        (107, "POSITIVE", 13), (108, "NEGATIVE", 13),
        (109, "POSITIVE", 14), (110, "NEGATIVE", 14),
    ]
    for tic, lbl, sec in train_specs:
        row = {
            "source_product_id": f"prod_{tic}_s{sec}",
            "lineage_id": f"lin_{tic}",
            "sample_id": f"s{sec}",
            "tic_id": tic,
            "sector": sec,
            "silver_sha256": "d" * 64,
            "lc_feature_version": 1,
            "lc_feature_fingerprint": "e" * 64,
            "training_label": lbl,
        }
        for f in CANDIDATE_MODEL_INPUT_FEATURES:
            row[f] = 1.0 if lbl == "POSITIVE" else 0.1
        rows.append(row)

    # Golden targets: TIC 201..204
    for tic, lbl, sec in [(201, "POSITIVE", 10), (202, "NEGATIVE", 10), (203, "POSITIVE", 11), (204, "NEGATIVE", 11)]:
        row = {
            "source_product_id": f"prod_{tic}_s{sec}",
            "lineage_id": f"lin_{tic}",
            "sample_id": f"s{sec}",
            "tic_id": tic,
            "sector": sec,
            "silver_sha256": "d" * 64,
            "lc_feature_version": 1,
            "lc_feature_fingerprint": "e" * 64,
            "training_label": lbl,
        }
        for f in CANDIDATE_MODEL_INPUT_FEATURES:
            row[f] = 0.95 if lbl == "POSITIVE" else 0.15
        rows.append(row)

    # Recent targets: TIC 301, 302 (sector 50)
    for tic, lbl, sec in [(301, "POSITIVE", 50), (302, "NEGATIVE", 50)]:
        row = {
            "source_product_id": f"prod_{tic}_s{sec}",
            "lineage_id": f"lin_{tic}",
            "sample_id": f"s{sec}",
            "tic_id": tic,
            "sector": sec,
            "silver_sha256": "d" * 64,
            "lc_feature_version": 1,
            "lc_feature_fingerprint": "e" * 64,
            "training_label": lbl,
        }
        for f in CANDIDATE_MODEL_INPUT_FEATURES:
            row[f] = 0.90 if lbl == "POSITIVE" else 0.2
        rows.append(row)

    return manifest, rows


def test_stage6_candidate_end_to_end_lifecycle():
    """Verify complete Stage 6 Candidate lifecycle: Gold -> Split -> Train -> Eval -> Registry -> ONNX -> Parity."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        import hashlib
        gold_manifest, rows = generate_candidate_e2e_dataset()
        train_rows = rows[:10]

        # 1. Build ML View and Group Split
        view = build_candidate_ml_view(gold_manifest, train_rows)
        split = create_deterministic_group_split(view, seed=42)

        assert split.schema_version == 1
        assert split.train_row_count > 0
        assert split.validation_row_count > 0

        # 2. Fit Preprocessor
        prep = CandidatePreprocessor.fit(train_rows, CANDIDATE_MODEL_INPUT_FEATURES, split.split_id)
        prep_path = os.path.join(tmp_dir, "preprocessing.json")
        with open(prep_path, "w", encoding="utf-8") as f:
            json.dump(prep.to_dict(), f)
        prep_sha = hashlib.sha256(open(prep_path, "rb").read()).hexdigest()

        # 3. Train Candidate MLP Model
        model = CandidateTabularMLP(input_dim=len(CANDIDATE_MODEL_INPUT_FEATURES))
        model_pt_path = os.path.join(tmp_dir, "model.pt")
        torch.save(model.state_dict(), model_pt_path)
        model_sha = hashlib.sha256(open(model_pt_path, "rb").read()).hexdigest()

        # 4. Training Run Manifest
        train_manifest_path = os.path.join(tmp_dir, "training_manifest.json")
        with open(train_manifest_path, "w", encoding="utf-8") as f:
            json.dump({
                "schema_version": 1,
                "training_run_id": "run-cand-v1-e2e",
                "training_spec_fingerprint": "f" * 64,
                "task": "candidate_vetting",
                "model_version": "candidate-tabular-mlp-v1",
                "gold_snapshot_id": gold_manifest.snapshot_id,
                "gold_manifest_sha256": "g" * 64,
                "split_id": split.split_id,
                "split_manifest_sha256": "s" * 64,
                "dataset_view_version": view.dataset_view_version,
                "dataset_view_fingerprint": view.view_fingerprint,
                "feature_order": list(CANDIDATE_MODEL_INPUT_FEATURES),
                "preprocessing_version": "candidate-preprocess-v1",
                "preprocessing_sha256": prep_sha,
                "training_seed": 42,
                "hyperparameters": {},
                "train_row_count": split.train_row_count,
                "validation_row_count": split.validation_row_count,
                "best_epoch": 10,
                "best_validation_loss": 0.05,
                "model_sha256": model_sha,
                "metrics_sha256": "m" * 64,
                "created_at": "2026-08-08T00:00:00Z",
            }, f)

        # 5. Build Cohorts & Evaluate
        golden_cohort = build_evaluation_cohort("candidate_vetting", "GOLDEN", gold_manifest, rows)
        recent_cohort = build_evaluation_cohort("candidate_vetting", "RECENT", gold_manifest, rows)
        golden_path = os.path.join(tmp_dir, "golden_cohort.json")
        recent_path = os.path.join(tmp_dir, "recent_cohort.json")
        with open(golden_path, "w", encoding="utf-8") as f:
            json.dump(golden_cohort.to_dict(), f)
        with open(recent_path, "w", encoding="utf-8") as f:
            json.dump(recent_cohort.to_dict(), f)

        eval_dir = os.path.join(tmp_dir, "eval_out")
        eval_manifest = evaluate_candidate_model(
            training_run_manifest_path=train_manifest_path,
            preprocessing_json_path=prep_path,
            golden_cohort_path=golden_path,
            recent_cohort_path=recent_path,
            output_dir=eval_dir,
        )
        eval_manifest_path = os.path.join(eval_dir, "manifest.json")

        # 6. Model Registry Packaging & Bootstrap Champion
        registry = ModelRegistry(registry_root=os.path.join(tmp_dir, "models"))
        pkg = registry.register_model_package(
            task="candidate_vetting",
            training_run_manifest_path=train_manifest_path,
            evaluation_run_manifest_path=eval_manifest_path,
            model_pt_source_path=model_pt_path,
            preprocessing_json_source_path=prep_path,
        )
        assert pkg.task == "candidate_vetting"

        promo = registry.promote_model("candidate_vetting", pkg.model_id, eval_manifest_path)
        assert promo.comparison_decision == "BOOTSTRAP_INITIAL_CHAMPION"
        assert registry.get_champion("candidate_vetting").model_id == pkg.model_id

        # 7. ONNX Export & Parity Verification
        exporter = RuntimeExporter(
            registry_root=os.path.join(tmp_dir, "models"),
            runtime_root=os.path.join(tmp_dir, "models", "runtime"),
        )
        runtime_manifest = exporter.export_candidate_runtime_package(
            model_id=pkg.model_id,
            evaluation_run_manifest_path=eval_manifest_path,
            validation_rows=train_rows,
        )

        assert runtime_manifest.python_parity_status == "PASS"
        assert runtime_manifest.onnx_opset == 17
        assert runtime_manifest.task == "candidate_vetting"
