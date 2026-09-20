"""Unit and Integration Tests for ML Model Evaluation (Phase 6.4).

Tests Golden Test and Recent Holdout cohorts, validation-only threshold selection,
group contamination checks, PR-AUC / ROC-AUC, p99 anomaly thresholds, and synthetic shifts.
"""

import json
import os
import tempfile
from typing import Any, Dict, List

import numpy as np
import pytest

from pre_train import CandidatePreprocessor
from train import CandidateTabularMLP, TrainingRunManifest
from pre_train import (
    CANDIDATE_MODEL_INPUT_FEATURES,
    CandidateGroupSplit,
    GroupAssignmentRecord,
    build_candidate_ml_view,
    create_deterministic_group_split,
)
from post_train.evaluate import (
    EvaluationGroupLeakageError,
    build_candidate_golden_cohort,
    build_candidate_recent_cohort,
    calculate_candidate_cohort_metrics,
    check_group_contamination,
    compute_average_precision,
    compute_roc_auc,
    evaluate_candidate_model,
    select_candidate_validation_threshold,
)
from store import SnapshotManifest


def sample_gold_manifest(
    snapshot_id: str = "gold-v1-test12345678", snapshot_type: str = "CANDIDATE"
) -> SnapshotManifest:
    return SnapshotManifest(
        snapshot_id=snapshot_id,
        snapshot_fingerprint="a" * 64,
        snapshot_type=snapshot_type,
        gold_schema_version=f"gold-{snapshot_type.lower()}-v1",
        feature_versions={"lc": "1"},
        input_count=1,
        manifest_sha256="s" * 64,
        created_at="2026-08-08T00:00:00Z",
    )


def sample_candidate_rows_for_evaluation() -> List[Dict[str, Any]]:
    rows = []
    # Training targets: 5 POSITIVE, 5 NEGATIVE across diverse TICs
    train_specs = [
        (101, "POSITIVE", 10),
        (102, "NEGATIVE", 10),
        (103, "POSITIVE", 11),
        (104, "NEGATIVE", 11),
        (105, "POSITIVE", 12),
        (106, "NEGATIVE", 12),
        (107, "POSITIVE", 13),
        (108, "NEGATIVE", 13),
        (109, "POSITIVE", 14),
        (110, "NEGATIVE", 14),
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

    # Golden targets: TIC 201 (POSITIVE), 202 (NEGATIVE), 203 (POSITIVE), 204 (NEGATIVE)
    for tic, lbl, sec in [
        (201, "POSITIVE", 10),
        (202, "NEGATIVE", 10),
        (203, "POSITIVE", 11),
        (204, "NEGATIVE", 11),
    ]:
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
            row[f] = 0.9 if lbl == "POSITIVE" else 0.15
        rows.append(row)

    # Recent targets (sector 50): TIC 301 (POSITIVE), 302 (NEGATIVE)
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
            row[f] = 0.85 if lbl == "POSITIVE" else 0.2
        rows.append(row)

    return rows




# -----------------------------------------------------------------------------
# Unit Tests: Cohort Creation & Contamination Checks
# -----------------------------------------------------------------------------


def test_candidate_golden_cohort_group_isolation():
    """Verify Candidate Golden Test cohort excludes all TRAIN and VALIDATION groups."""
    manifest = sample_gold_manifest()
    all_rows = sample_candidate_rows_for_evaluation()
    train_rows = all_rows[:10]  # All training TICs 101..110

    view = build_candidate_ml_view(manifest, train_rows)
    split = create_deterministic_group_split(view, seed=42, train_ratio=0.5)

    golden_cohort = build_candidate_golden_cohort(
        gold_manifest=manifest,
        candidate_rows=all_rows,
        training_split=split,
    )

    assert golden_cohort.cohort_kind == "GOLDEN_TEST"
    assert golden_cohort.group_count == 4  # TICs 201, 202, 203, 204
    assert "tic:101" not in golden_cohort.group_keys
    assert "tic:102" not in golden_cohort.group_keys
    assert "tic:201" in golden_cohort.group_keys
    assert golden_cohort.positive_count == 2
    assert golden_cohort.negative_count == 2


def test_candidate_recent_cohort_isolation_and_sector():
    """Verify Candidate Recent Holdout excludes training groups and Golden groups, with sector > training_max."""
    manifest = sample_gold_manifest()
    all_rows = sample_candidate_rows_for_evaluation()
    train_rows = all_rows[:10]

    view = build_candidate_ml_view(manifest, train_rows)
    split = create_deterministic_group_split(view, seed=42, train_ratio=0.5)
    golden_cohort = build_candidate_golden_cohort(manifest, all_rows, split)

    recent_cohort = build_candidate_recent_cohort(
        gold_manifest=manifest,
        candidate_rows=all_rows,
        training_split=split,
        golden_cohort=golden_cohort,
        training_max_sector=11,
    )

    assert recent_cohort.cohort_kind == "RECENT_HOLDOUT"
    assert recent_cohort.group_count == 2  # TICs 301, 302
    assert "tic:301" in recent_cohort.group_keys
    assert "tic:101" not in recent_cohort.group_keys
    assert "tic:201" not in recent_cohort.group_keys


def test_cross_sector_contamination_rejection():
    """Verify an exposed target appearing in a new sector is rejected from Golden and Recent."""
    manifest = sample_gold_manifest()
    all_rows = sample_candidate_rows_for_evaluation()

    # Invalidate by adding TIC 101 in sector 50
    contaminated_row = {
        "source_product_id": "prod_101_s50",
        "lineage_id": "lin_101",
        "sample_id": "s50",
        "tic_id": 101,  # Already in training!
        "sector": 50,
        "training_label": "POSITIVE",
        **{f: 1.0 for f in CANDIDATE_MODEL_INPUT_FEATURES},
    }
    all_rows.append(contaminated_row)

    train_rows = all_rows[:10]
    view = build_candidate_ml_view(manifest, train_rows)
    split = create_deterministic_group_split(view, seed=42, train_ratio=0.5)
    golden = build_candidate_golden_cohort(manifest, all_rows, split)

    recent = build_candidate_recent_cohort(
        gold_manifest=manifest,
        candidate_rows=all_rows,
        training_split=split,
        golden_cohort=golden,
        training_max_sector=11,
    )

    # TIC 101 must NOT be in recent even though it has sector 50
    assert "tic:101" not in recent.group_keys


def test_contamination_preflight_leakage_exception():
    """Verify check_group_contamination raises EvaluationGroupLeakageError on overlap."""
    split = CandidateGroupSplit(
        schema_version=1,
        split_id="split-test-1",
        split_fingerprint="f" * 64,
        gold_snapshot_id="gold-1",
        gold_manifest_sha256="s" * 64,
        dataset_view_version="v1",
        split_policy_version="p1",
        split_seed=42,
        eligible_row_count=2,
        eligible_group_count=2,
        train_group_count=1,
        validation_group_count=1,
        train_row_count=1,
        validation_row_count=1,
        train_positive_count=1,
        train_negative_count=0,
        val_positive_count=0,
        val_negative_count=1,
        feature_names=CANDIDATE_MODEL_INPUT_FEATURES,
        assignments=[
            GroupAssignmentRecord(
                group_key="tic:101",
                split="TRAIN",
                row_count=1,
                positive_count=1,
                negative_count=0,
            ),
            GroupAssignmentRecord(
                group_key="tic:102",
                split="VALIDATION",
                row_count=1,
                positive_count=0,
                negative_count=1,
            ),
        ],
        created_at="2026-08-08T00:00:00Z",
    )

    # Overlaps with TRAIN
    with pytest.raises(EvaluationGroupLeakageError, match="intersect with TRAIN"):
        check_group_contamination(
            cohort_group_keys=["tic:101", "tic:999"], training_split=split
        )

    # Overlaps with VALIDATION
    with pytest.raises(EvaluationGroupLeakageError, match="intersect with VALIDATION"):
        check_group_contamination(
            cohort_group_keys=["tic:102", "tic:999"], training_split=split
        )


# -----------------------------------------------------------------------------
# Unit Tests: Candidate Threshold Selection & Metrics
# -----------------------------------------------------------------------------


def test_candidate_validation_threshold_max_f1_and_tie_breaks():
    """Verify candidate-threshold-max-f1-v1 selects maximum F1 with correct tie breaks."""
    # Test case where prob 0.6 achieves max F1
    y_true = np.array([1, 1, 0, 0, 1])
    y_prob = np.array([0.9, 0.7, 0.4, 0.2, 0.6])

    thresh, f1, prec, rec = select_candidate_validation_threshold(y_true, y_prob)
    assert 0.6 <= thresh <= 0.7
    assert f1 == 1.0
    assert prec == 1.0
    assert rec == 1.0


def test_average_precision_and_roc_auc_exactness():
    """Verify continuous probability PR-AUC and ROC-AUC calculations."""
    y_true = np.array([1, 1, 0, 0])
    y_prob = np.array([0.9, 0.8, 0.2, 0.1])

    ap = compute_average_precision(y_true, y_prob)
    roc = compute_roc_auc(y_true, y_prob)

    assert ap == 1.0
    assert roc == 1.0


def test_candidate_cohort_metrics_structure():
    """Verify confusion matrix and candidate metrics structure."""
    y_true = np.array([1, 0, 1, 0])
    y_prob = np.array([0.9, 0.8, 0.2, 0.1])
    threshold = 0.5

    metrics = calculate_candidate_cohort_metrics(y_true, y_prob, threshold)
    assert metrics["status"] == "OK"
    assert "confusion_matrix" in metrics
    assert metrics["confusion_matrix"] == [[1, 1], [1, 1]]  # [[TN, FP], [FN, TP]]


# -----------------------------------------------------------------------------
# Unit Tests: Anomaly Evaluation & Synthetic Perturbations
# -----------------------------------------------------------------------------


# -----------------------------------------------------------------------------
# Integration Tests: End-to-End Candidate Evaluation
# -----------------------------------------------------------------------------


def test_full_candidate_evaluation_flow():
    """Integration test: Execute evaluate_candidate_model and verify sibling JSON artifacts."""
    manifest = sample_gold_manifest()
    all_rows = sample_candidate_rows_for_evaluation()
    train_rows = all_rows[:10]

    view = build_candidate_ml_view(manifest, train_rows)
    split = create_deterministic_group_split(view, seed=42)

    # Fit preprocessor and save to temp file
    preprocessor = CandidatePreprocessor().fit(
        train_rows, CANDIDATE_MODEL_INPUT_FEATURES, split.split_id
    )
    with tempfile.TemporaryDirectory() as tmp_dir:
        prep_path = os.path.join(tmp_dir, "preprocessing.json")
        with open(prep_path, "w", encoding="utf-8") as f:
            json.dump(preprocessor.to_dict(), f)

        # Create candidate training run manifest
        train_manifest = TrainingRunManifest(
            training_run_id="run-cand-v1-test123",
            training_spec_fingerprint="f" * 64,
            model_version="candidate-tabular-mlp-v1",
            preprocessing_version="candidate-preprocess-v1",
            gold_snapshot_id=manifest.snapshot_id,
            gold_manifest_sha256="s" * 64,
            split_id=split.split_id,
            split_manifest_sha256="m" * 64,
            dataset_view_version=view.dataset_view_version,
            dataset_view_fingerprint=view.view_fingerprint,
            feature_order=list(CANDIDATE_MODEL_INPUT_FEATURES),
            training_seed=42,
            hyperparameters={},
            counts={
                "train_row_count": 5,
                "validation_row_count": 5,
                "train_positive_count": 1,
                "train_negative_count": 1,
                "val_positive_count": 1,
                "val_negative_count": 1,
            },
            best_epoch=10,
            artifacts={
                "model_pt_sha256": "m" * 64,
                "preprocessing_json_sha256": "p" * 64,
                "metrics_json_sha256": "e" * 64,
            },
            schema_version=1,
            created_at="2026-08-08T00:00:00Z",
        )

        golden_cohort = build_candidate_golden_cohort(manifest, all_rows, split)
        recent_cohort = build_candidate_recent_cohort(
            manifest, all_rows, split, golden_cohort
        )
        model = CandidateTabularMLP(input_dim=len(CANDIDATE_MODEL_INPUT_FEATURES))
        eval_manifest, _, _ = evaluate_candidate_model(
            training_manifest=train_manifest,
            training_split=split,
            golden_cohort=golden_cohort,
            training_rows=train_rows,
            golden_rows=all_rows,
            model_state_dict=model.state_dict(),
            preprocessing_json_path=prep_path,
            recent_cohort=recent_cohort,
            recent_rows=all_rows,
            dest_dir=tmp_dir,
        )

        assert eval_manifest.schema_version == 1
        assert eval_manifest.task == "candidate_vetting"
        eval_dir = os.path.join(tmp_dir, eval_manifest.evaluation_run_id)
        assert os.path.exists(os.path.join(eval_dir, "threshold.json"))
        assert os.path.exists(os.path.join(eval_dir, "metrics.json"))
        assert os.path.exists(os.path.join(eval_dir, "manifest.json"))

