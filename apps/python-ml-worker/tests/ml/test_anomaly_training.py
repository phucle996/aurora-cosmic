"""Unit & Integration Tests for Astronomical Anomaly Detection Training (Phase 6.3)."""

import json
import os
import tempfile
from dataclasses import replace

import numpy as np
import pytest
import torch

from aurora_ml.ml.anomaly.checkpoint import (
    AnomalyTrainingRunCheckpoint,
    AnomalyTrainingRunManifest,
    AnomalyTrainingRunSpec,
    derive_anomaly_training_run_identity,
)
from aurora_ml.ml.anomaly.model import (
    AnomalyLightcurveAutoencoder,
    compute_reconstruction_mse,
)
from aurora_ml.ml.anomaly.preprocessor import (
    ANOMALY_MODEL_INPUT_FEATURES,
    AnomalyPreprocessor,
)
from aurora_ml.ml.anomaly.train import (
    AnomalyTrainingError,
    train_anomaly_model,
)
from aurora_ml.ml.datasets.splits import (
    build_anomaly_ml_view,
    create_anomaly_group_split,
)
from aurora_ml.pipeline.gold import GoldSnapshotManifest


def sample_gold_anomaly_manifest() -> GoldSnapshotManifest:
    """Fixture producing a valid committed Gold snapshot manifest for anomaly task."""
    manifest = GoldSnapshotManifest(
        schema_version=1,
        snapshot_id="gold-v1-anom12345678",
        snapshot_fingerprint="b" * 64,
        snapshot_type="ANOMALY",
        gold_schema_version="gold-anomaly-v1",
        feature_versions={"lc": "lc-features-v1"},
        input_count=0,
        inputs=[],
        created_at="2026-08-08T00:00:00Z",
    )
    return manifest


def sample_anomaly_row(tic_id: int, sector: int, flux_std_val: float = 0.01) -> dict:
    """Fixture producing a sample row for anomaly dataset."""
    return {
        "source_product_id": f"prod_anom_{tic_id}_s{sector}",
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
        "flux_std": flux_std_val,
        "flux_mad": 0.008,
        "flux_robust_sigma": 0.0118,
        "flux_amplitude": 0.05,
        "flux_rms": 0.01,
        "flux_skewness": 0.1,
        "flux_kurtosis": 0.2,
        "median_flux_err": 0.001,
        "training_label": "UNRESOLVED",  # Unsupervised task ignores labels
    }


def sample_anomaly_training_rows() -> list[dict]:
    """Fixture producing 10 target groups for anomaly training tests."""
    rows = []
    for tic in range(101, 111):
        rows.append(sample_anomaly_row(tic, 10, flux_std_val=0.01 * (tic - 100)))
    return rows


# --- Unit Tests ---

def test_anomaly_preprocessor_train_only_fit():
    """Verify preprocessor statistics are computed strictly on TRAIN rows."""
    train_rows = [
        sample_anomaly_row(101, 10, flux_std_val=0.02),
        sample_anomaly_row(102, 10, flux_std_val=0.04),
    ]
    val_rows = [
        sample_anomaly_row(201, 10, flux_std_val=999.0),  # Outlier in validation
    ]

    prep = AnomalyPreprocessor()
    prep.fit(train_rows, split_id="split-anom-1")

    # Median of TRAIN flux_std (0.02 and 0.04) should be 0.03
    assert prep.feature_medians["flux_std"] == pytest.approx(0.03)

    # Validation transform should not affect preprocessor medians
    X_val = prep.transform_features(val_rows)
    assert not np.isnan(X_val).any()
    assert prep.feature_medians["flux_std"] == pytest.approx(0.03)


def test_anomaly_preprocessor_constant_feature_scale():
    """Verify zero variance feature gets scale = 1.0."""
    train_rows = [
        sample_anomaly_row(101, 10),
        sample_anomaly_row(102, 10),
    ]
    # All rows have constant n_points = 1000
    prep = AnomalyPreprocessor()
    prep.fit(train_rows)

    assert prep.feature_scales["n_points"] == 1.0


def test_anomaly_preprocessor_json_roundtrip():
    """Verify serialization and deserialization of AnomalyPreprocessor."""
    train_rows = [sample_anomaly_row(101, 10), sample_anomaly_row(102, 10)]
    prep = AnomalyPreprocessor()
    prep.fit(train_rows, split_id="split-anom-v1")

    json_str = prep.to_json()
    loaded_prep = AnomalyPreprocessor.from_json(json_str)

    assert loaded_prep.split_id == prep.split_id
    assert loaded_prep.feature_medians == prep.feature_medians
    assert loaded_prep.feature_means == prep.feature_means
    assert loaded_prep.feature_scales == prep.feature_scales


def test_autoencoder_architecture_shapes():
    """Verify AnomalyLightcurveAutoencoder reconstruction shape and bottleneck latent shape."""
    model = AnomalyLightcurveAutoencoder(input_dim=14, hidden_dims=(32, 8))
    x = torch.randn(10, 14, dtype=torch.float32)

    reconstructed = model(x)
    latent = model.encode(x)

    assert reconstructed.shape == (10, 14)
    assert latent.shape == (10, 8)


def test_compute_reconstruction_mse():
    """Verify per-row reconstruction MSE score calculations."""
    x = torch.tensor([[0.0, 2.0], [1.0, 1.0]], dtype=torch.float32)
    x_hat = torch.tensor([[0.0, 0.0], [1.0, 1.0]], dtype=torch.float32)

    scores = compute_reconstruction_mse(x, x_hat)

    # Row 0: ((0-0)^2 + (2-0)^2)/2 = 2.0
    # Row 1: ((1-1)^2 + (1-1)^2)/2 = 0.0
    assert scores[0].item() == pytest.approx(2.0)
    assert scores[1].item() == pytest.approx(0.0)
    assert (scores >= 0).all()


def test_anomaly_spec_fingerprint_determinism():
    """Verify spec fingerprint is deterministic and sensitive to hyperparams/seed."""
    run_id_1, fp_1 = derive_anomaly_training_run_identity(
        model_version="anomaly-lightcurve-autoencoder-v1",
        preprocessing_version="anomaly-lightcurve-preprocess-v1",
        score_definition_version="reconstruction-mse-v1",
        gold_snapshot_id="gold-anom-1",
        split_id="split-1",
        dataset_view_fingerprint="view-fp-1",
        feature_order=ANOMALY_MODEL_INPUT_FEATURES,
        training_seed=42,
        hyperparameters={"lr": 0.001},
    )

    run_id_2, fp_2 = derive_anomaly_training_run_identity(
        model_version="anomaly-lightcurve-autoencoder-v1",
        preprocessing_version="anomaly-lightcurve-preprocess-v1",
        score_definition_version="reconstruction-mse-v1",
        gold_snapshot_id="gold-anom-1",
        split_id="split-1",
        dataset_view_fingerprint="view-fp-1",
        feature_order=ANOMALY_MODEL_INPUT_FEATURES,
        training_seed=42,
        hyperparameters={"lr": 0.001},
    )

    _, fp_different_lr = derive_anomaly_training_run_identity(
        model_version="anomaly-lightcurve-autoencoder-v1",
        preprocessing_version="anomaly-lightcurve-preprocess-v1",
        score_definition_version="reconstruction-mse-v1",
        gold_snapshot_id="gold-anom-1",
        split_id="split-1",
        dataset_view_fingerprint="view-fp-1",
        feature_order=ANOMALY_MODEL_INPUT_FEATURES,
        training_seed=42,
        hyperparameters={"lr": 0.002},
    )

    assert fp_1 == fp_2
    assert run_id_1 == run_id_2
    assert fp_1 != fp_different_lr


# --- Integration Tests ---

def test_full_anomaly_training_flow():
    """Integration test: Execute train_anomaly_model and verify artifacts."""
    manifest = sample_gold_anomaly_manifest()
    rows = sample_anomaly_training_rows()

    view = build_anomaly_ml_view(manifest, rows)
    split = create_anomaly_group_split(view, seed=42)

    with tempfile.TemporaryDirectory() as tmp_dir:
        run_manifest, run_chkpt = train_anomaly_model(
            gold_manifest=manifest,
            split_manifest=split,
            rows=rows,
            training_seed=42,
            epochs=5,
            batch_size=4,
            early_stopping_patience=3,
            dest_dir=tmp_dir,
        )

        assert isinstance(run_manifest, AnomalyTrainingRunManifest)
        assert isinstance(run_chkpt, AnomalyTrainingRunCheckpoint)
        assert run_chkpt.status == "COMPLETED"
        assert run_manifest.task == "astronomical_anomaly_detection"

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
            assert manifest_dict["model_version"] == "anomaly-lightcurve-autoencoder-v1"
            assert manifest_dict["score_definition_version"] == "reconstruction-mse-v1"
            assert len(manifest_dict["feature_order"]) == 14


def test_mismatched_gold_anomaly_snapshot_rejection():
    """Verify anomaly training rejects split manifest pointing to a different Gold snapshot ID."""
    manifest = sample_gold_anomaly_manifest()
    rows = sample_anomaly_training_rows()
    view = build_anomaly_ml_view(manifest, rows)
    split = create_anomaly_group_split(view, seed=42)

    wrong_split = replace(split, gold_snapshot_id="gold-v1-wrong")

    with pytest.raises(AnomalyTrainingError, match="SPLIT_GOLD_MISMATCH"):
        train_anomaly_model(
            gold_manifest=manifest,
            split_manifest=wrong_split,
            rows=rows,
        )
