"""Unit & Integration Tests for Candidate Vetting Model Training (Phase 6.2)."""

from dataclasses import replace
import json
import os
import tempfile

import numpy as np
import pytest
import torch

from aurora_ml.ml.candidate.checkpoint import (
    TrainingRunCheckpoint,
    TrainingRunManifest,
    derive_training_run_identity,
)
from aurora_ml.ml.candidate.model import CandidateTabularMLP
from aurora_ml.ml.candidate.preprocessor import (
    CandidatePreprocessor,
)
from aurora_ml.ml.candidate.train import (
    CandidateTrainingError,
    calculate_binary_metrics,
    train_candidate_model,
)
from aurora_ml.ml.datasets.splits import (
    CANDIDATE_MODEL_INPUT_FEATURES,
    build_candidate_ml_view,
    create_deterministic_group_split,
)
from aurora_ml.pipeline.gold import GoldSnapshotManifest


def sample_gold_manifest() -> GoldSnapshotManifest:
    """Fixture producing a valid committed Gold snapshot manifest."""
    manifest = GoldSnapshotManifest(
        schema_version=1,
        snapshot_id="gold-v1-test12345678",
        snapshot_fingerprint="a" * 64,
        snapshot_type="CANDIDATE",
        gold_schema_version="gold-candidate-v1",
        feature_versions={"lc": "lc-features-v1"},
        input_count=0,
        inputs=[],
        created_at="2026-08-08T00:00:00Z",
    )
    return manifest


def sample_row(
    tic_id: int, sector: int, label: str, bls_depth_val: float = 0.01
) -> dict:
    """Fixture producing a sample row for candidate dataset."""
    return {
        "source_product_id": f"prod_{tic_id}_s{sector}",
        "lineage_id": f"lin_{tic_id}",
        "sample_id": f"s{sector}",
        "tic_id": tic_id,
        "sector": sector,
        "silver_sha256": f"sha{tic_id}{sector}",
        "lc_feature_version": "lc-features-v1",
        "lc_feature_fingerprint": "fp1",
        "n_points": 1000,
        "time_span": 20.0,
        "median_cadence": 0.001,
        "max_gap": 0.1,
        "flux_mean": 0.0,
        "flux_median": 0.0,
        "flux_std": 0.01,
        "flux_mad": 0.008,
        "flux_robust_sigma": 0.0118,
        "flux_amplitude": 0.05,
        "flux_rms": 0.01,
        "flux_skewness": 0.1,
        "flux_kurtosis": 0.2,
        "median_flux_err": 0.001,
        "bls_available": True,
        "bls_period": 5.0,
        "bls_duration": 0.2,
        "bls_transit_time": 0.1,
        "bls_depth": bls_depth_val,
        "bls_power": 100.0,
        "tpf_evidence_available": False,
        "pixel_mad_median": None,
        "variability_peak_fraction": None,
        "transit_evidence_available": False,
        "transit_deficit_sum": None,
        "transit_deficit_centroid_row": None,
        "transit_deficit_centroid_col": None,
        "transit_deficit_center_offset_pixels": None,
        "tic_available": True,
        "tmag": 10.0,
        "teff": 5800.0,
        "stellar_radius": 1.0,
        "stellar_mass": 1.0,
        "logg": 4.4,
        "matched_toi_id": f"{tic_id}.01" if label in ("POSITIVE", "NEGATIVE") else None,
        "toi_match_status": "EPHEMERIS_MATCH"
        if label in ("POSITIVE", "NEGATIVE")
        else "NO_MATCH",
        "toi_period_error": 0.001 if label in ("POSITIVE", "NEGATIVE") else None,
        "matched_tce_id": None,
        "tce_match_status": "NO_MATCH",
        "training_label": label,
        "label_policy_version": "candidate-label-policy-v1",
    }


def sample_training_rows() -> list[dict]:
    """Fixture producing 12 target groups for training tests."""
    rows = []
    # 6 POSITIVE target groups
    for tic in [1001, 1002, 1003, 1004, 1005, 1006]:
        rows.append(sample_row(tic, 10, "POSITIVE", bls_depth_val=0.05))
    # 6 NEGATIVE target groups
    for tic in [2001, 2002, 2003, 2004, 2005, 2006]:
        rows.append(sample_row(tic, 10, "NEGATIVE", bls_depth_val=0.001))
    # 1 UNRESOLVED
    rows.append(sample_row(3001, 10, "UNRESOLVED"))
    return rows


# --- Unit Tests ---


def test_preprocessor_train_only_fit():
    """Verify preprocessor medians and scales are computed strictly on TRAIN rows."""
    train_rows = [
        sample_row(1001, 10, "POSITIVE", bls_depth_val=0.02),
        sample_row(1002, 10, "NEGATIVE", bls_depth_val=0.04),
    ]
    val_rows = [
        sample_row(2001, 10, "POSITIVE", bls_depth_val=999.0),  # Extreme outlier in VAL
    ]

    prep = CandidatePreprocessor()
    prep.fit(train_rows, split_id="split-1")

    # Median of TRAIN bls_depth (0.02 and 0.04) should be 0.03
    assert prep.feature_medians["bls_depth"] == pytest.approx(0.03)

    # Validation values should NOT affect preprocessor stats
    X_val = prep.transform_features(val_rows)
    assert not np.isnan(X_val).any()
    assert prep.feature_medians["bls_depth"] == pytest.approx(0.03)


def test_preprocessor_constant_feature_scale():
    """Verify zero variance features get scale = 1.0 (no divide-by-zero)."""
    train_rows = [
        sample_row(1001, 10, "POSITIVE"),
        sample_row(1002, 10, "NEGATIVE"),
    ]
    # All rows have constant tmag = 10.0
    prep = CandidatePreprocessor()
    prep.fit(train_rows)

    assert prep.feature_scales["tmag"] == 1.0


def test_preprocessor_json_roundtrip():
    """Verify serialization and deserialization of CandidatePreprocessor."""
    train_rows = [sample_row(1001, 10, "POSITIVE"), sample_row(2001, 10, "NEGATIVE")]
    prep = CandidatePreprocessor()
    prep.fit(train_rows, split_id="split-v1-test")

    json_str = prep.to_json()
    loaded_prep = CandidatePreprocessor.from_json(json_str)

    assert loaded_prep.split_id == prep.split_id
    assert loaded_prep.feature_medians == prep.feature_medians
    assert loaded_prep.feature_means == prep.feature_means
    assert loaded_prep.feature_scales == prep.feature_scales


def test_mlp_architecture_shapes():
    """Verify CandidateTabularMLP forward pass shapes and raw logit output."""
    model = CandidateTabularMLP(input_dim=32, hidden_dims=(64, 32))
    x = torch.randn(10, 32, dtype=torch.float32)
    out = model(x)

    assert out.shape == (10, 1)
    # Forward pass outputs raw logits (can be negative or positive)
    assert isinstance(out, torch.Tensor)


def test_calculate_binary_metrics():
    """Verify metric calculations for PR-AUC, ROC-AUC, F1, precision, recall."""
    y_true = np.array([1, 1, 0, 0], dtype=float)
    y_prob = np.array([0.9, 0.8, 0.2, 0.1], dtype=float)

    metrics = calculate_binary_metrics(y_true, y_prob, threshold=0.5)

    assert metrics["validation_roc_auc"] == pytest.approx(1.0)
    assert metrics["validation_pr_auc"] == pytest.approx(1.0)
    assert metrics["diagnostic_metrics_at_0_5"]["precision"] == 1.0
    assert metrics["diagnostic_metrics_at_0_5"]["recall"] == 1.0
    assert metrics["diagnostic_metrics_at_0_5"]["f1_score"] == 1.0


def test_training_spec_fingerprint_determinism():
    """Verify training spec fingerprint is deterministic and sensitive to hyperparams/seed."""
    run_id_1, fp_1 = derive_training_run_identity(
        model_version="candidate-tabular-mlp-v1",
        preprocessing_version="candidate-preprocess-v1",
        gold_snapshot_id="gold-1",
        split_id="split-1",
        dataset_view_fingerprint="view-fp-1",
        feature_order=CANDIDATE_MODEL_INPUT_FEATURES,
        training_seed=42,
        hyperparameters={"lr": 0.001},
    )

    run_id_2, fp_2 = derive_training_run_identity(
        model_version="candidate-tabular-mlp-v1",
        preprocessing_version="candidate-preprocess-v1",
        gold_snapshot_id="gold-1",
        split_id="split-1",
        dataset_view_fingerprint="view-fp-1",
        feature_order=CANDIDATE_MODEL_INPUT_FEATURES,
        training_seed=42,
        hyperparameters={"lr": 0.001},
    )

    # Mismatched seed -> different fingerprint
    _, fp_different_seed = derive_training_run_identity(
        model_version="candidate-tabular-mlp-v1",
        preprocessing_version="candidate-preprocess-v1",
        gold_snapshot_id="gold-1",
        split_id="split-1",
        dataset_view_fingerprint="view-fp-1",
        feature_order=CANDIDATE_MODEL_INPUT_FEATURES,
        training_seed=43,
        hyperparameters={"lr": 0.001},
    )

    assert fp_1 == fp_2
    assert run_id_1 == run_id_2
    assert fp_1 != fp_different_seed


# --- Integration Tests ---


def test_full_candidate_training_flow_on_cpu():
    """Integration test: Execute train_candidate_model and verify artifacts."""
    manifest = sample_gold_manifest()
    rows = sample_training_rows()

    view = build_candidate_ml_view(manifest, rows)
    split = create_deterministic_group_split(view, seed=42)
    progress_events = []

    with tempfile.TemporaryDirectory() as tmp_dir:
        run_manifest, run_chkpt = train_candidate_model(
            gold_manifest=manifest,
            split_manifest=split,
            rows=rows,
            training_seed=42,
            epochs=5,
            batch_size=4,
            early_stopping_patience=3,
            dest_dir=tmp_dir,
            device_str="cpu",
            progress_callback=progress_events.append,
        )

        assert isinstance(run_manifest, TrainingRunManifest)
        assert isinstance(run_chkpt, TrainingRunCheckpoint)
        assert run_chkpt.status == "COMPLETED"
        assert progress_events
        assert progress_events[-1]["current_epoch"] == run_chkpt.current_epoch
        assert progress_events[-1]["total_epochs"] == 5
        assert progress_events[-1]["best_val_loss"] == run_chkpt.best_val_loss

        # Check output files exist
        assert os.path.exists(os.path.join(tmp_dir, "model.pt"))
        assert os.path.exists(os.path.join(tmp_dir, "preprocessing.json"))
        assert os.path.exists(os.path.join(tmp_dir, "metrics.json"))
        assert os.path.exists(os.path.join(tmp_dir, "manifest.json"))

        # Verify manifest content
        with open(os.path.join(tmp_dir, "manifest.json"), encoding="utf-8") as f:
            manifest_dict = json.load(f)
            assert manifest_dict["gold_snapshot_id"] == manifest.snapshot_id
            assert manifest_dict["split_id"] == split.split_id
            assert manifest_dict["dataset_view_version"] == "candidate-ml-view-v2"
            assert len(manifest_dict["feature_order"]) == 31
            assert manifest_dict["hyperparameters"]["compute_target"] == "cpu"


def test_mismatched_gold_snapshot_rejection():
    """Verify training rejects split manifest pointing to a different Gold snapshot ID."""
    manifest = sample_gold_manifest()
    rows = sample_training_rows()
    view = build_candidate_ml_view(manifest, rows)
    split = create_deterministic_group_split(view, seed=42)

    # Tamper split's gold_snapshot_id using replace()
    wrong_split = replace(split, gold_snapshot_id="gold-v1-wrong")

    with pytest.raises(CandidateTrainingError, match="SPLIT_GOLD_MISMATCH"):
        train_candidate_model(
            gold_manifest=manifest,
            split_manifest=wrong_split,
            rows=rows,
        )
