"""Synthetic Data & Model Generator for ML Worker Benchmarks."""

from __future__ import annotations

import random
from typing import Any, Dict, List, Tuple

import numpy as np
import torch

from pre_train import (
    CANDIDATE_MODEL_INPUT_FEATURES,
    CandidateGroupSplit,
    CandidatePreprocessor,
    build_candidate_ml_view,
    create_deterministic_group_split,
    derive_group_key,
)
from store import SnapshotManifest
from train import CandidateTabularMLP


def generate_synthetic_catalog_rows(
    num_objects: int = 100,
    observations_per_object: int = 5,
    seed: int = 42,
) -> List[Dict[str, Any]]:
    """Generate synthetic candidate observations with realistic astronomy distributions."""
    rng = random.Random(seed)
    np_rng = np.random.default_rng(seed)
    rows: List[Dict[str, Any]] = []

    for obj_idx in range(num_objects):
        obj_id = f"TIC-{100000000 + obj_idx}"
        is_planet_candidate = (obj_idx % 5 == 0)  # 20% positive class balance

        # Base physical parameters per star
        stellar_mass = float(np_rng.uniform(0.5, 1.8))
        stellar_radius = float(np_rng.uniform(0.6, 2.2))
        teff = float(np_rng.uniform(3500.0, 7500.0))
        logg = float(np_rng.uniform(3.8, 4.8))
        tmag = float(np_rng.uniform(8.0, 15.5))

        # Partition into sectors: 1 for dev/golden, 50 for recent holdout
        sector = 50 if obj_idx >= int(num_objects * 0.85) else 1

        for obs_idx in range(observations_per_object):
            time_span = float(np_rng.uniform(25.0, 30.0))
            n_points = int(np_rng.integers(1200, 3500))

            if is_planet_candidate:
                label = "POSITIVE"
                bls_power = float(np_rng.uniform(0.25, 0.85))
                bls_depth = float(np_rng.uniform(0.005, 0.035))
                bls_period = float(np_rng.uniform(1.2, 18.0))
                bls_duration = float(np_rng.uniform(0.05, 0.25))
            else:
                label = "NEGATIVE"
                bls_power = float(np_rng.uniform(0.01, 0.15))
                bls_depth = float(np_rng.uniform(0.0001, 0.004))
                bls_period = float(np_rng.uniform(0.2, 35.0))
                bls_duration = float(np_rng.uniform(0.01, 0.10))

            row: Dict[str, Any] = {
                "source_product_id": f"SRC-{obj_id}-{obs_idx}",
                "object_id": obj_id,
                "tic_id": 100000000 + obj_idx,
                "sector": sector,
                "training_label": label,
                "bls_available": 1.0,
                "bls_depth": bls_depth,
                "bls_duration": bls_duration,
                "bls_period": bls_period,
                "bls_power": bls_power,
                "bls_transit_time": float(np_rng.uniform(100.0, 200.0)),
                "flux_amplitude": float(np_rng.uniform(0.01, 0.08)),
                "flux_kurtosis": float(np_rng.uniform(-0.5, 3.5)),
                "flux_mad": float(np_rng.uniform(0.001, 0.01)),
                "flux_mean": float(np_rng.normal(1.0, 0.02)),
                "flux_median": 1.0,
                "flux_rms": float(np_rng.uniform(0.002, 0.015)),
                "flux_robust_sigma": float(np_rng.uniform(0.001, 0.012)),
                "flux_skewness": float(np_rng.normal(0.0, 0.5)),
                "flux_std": float(np_rng.uniform(0.002, 0.015)),
                "logg": logg,
                "max_gap": float(np_rng.uniform(0.5, 2.5)),
                "median_cadence": 0.001388,  # 2-min cadence
                "median_flux_err": float(np_rng.uniform(0.0005, 0.002)),
                "n_points": n_points,
                "pixel_mad_median": float(np_rng.uniform(0.001, 0.005)),
                "stellar_mass": stellar_mass,
                "stellar_radius": stellar_radius,
                "teff": teff,
                "tic_available": 1.0,
                "time_span": time_span,
                "tmag": tmag,
                "transit_deficit_center_offset_pixels": float(np_rng.uniform(0.0, 1.5)),
                "transit_deficit_centroid_col": float(np_rng.uniform(10.0, 90.0)),
                "transit_deficit_centroid_row": float(np_rng.uniform(10.0, 90.0)),
                "transit_deficit_sum": float(np_rng.uniform(0.01, 0.5)),
            }
            rows.append(row)

    rng.shuffle(rows)
    return rows


def generate_benchmark_split_and_data(
    num_objects: int = 200,
    seed: int = 42,
) -> Tuple[SnapshotManifest, CandidateGroupSplit, List[Dict[str, Any]], CandidatePreprocessor]:
    """Generate complete in-memory pre-train split and fitted preprocessor."""
    rows = generate_synthetic_catalog_rows(num_objects=num_objects, seed=seed)
    manifest = SnapshotManifest(
        snapshot_id="gold-v1-bench-001",
        manifest_sha256="b" * 64,
        snapshot_fingerprint="fp-" + ("b" * 32),
        snapshot_type="CANDIDATE",
        input_count=len(rows),
        created_at="2026-09-21T00:00:00Z",
    )
    # Reserve first 70% of objects for training/validation split
    dev_tic_cutoff = 100000000 + int(num_objects * 0.70)
    dev_rows = [r for r in rows if r["tic_id"] < dev_tic_cutoff]

    view = build_candidate_ml_view(manifest, dev_rows)
    split = create_deterministic_group_split(view, seed=seed)

    # Fit preprocessor on train rows
    train_keys = {
        assign.group_key for assign in split.assignments if assign.split == "TRAIN"
    }
    train_rows = [r for r in dev_rows if derive_group_key(r) in train_keys]
    prep = CandidatePreprocessor().fit(train_rows, split_id=split.split_id)
    return manifest, split, rows, prep


def generate_benchmark_torch_dataset(
    num_samples: int = 5000,
    input_dim: int = len(CANDIDATE_MODEL_INPUT_FEATURES),
    device: str = "cpu",
    seed: int = 42,
) -> Tuple[torch.Tensor, torch.Tensor]:
    """Generate random torch tensor batches directly on target device."""
    gen = torch.Generator().manual_seed(seed)
    features = torch.randn(num_samples, input_dim, dtype=torch.float32, generator=gen)
    targets = torch.randint(0, 2, (num_samples, 1), dtype=torch.float32, generator=gen)

    if device == "cuda" and torch.cuda.is_available():
        features = features.cuda()
        targets = targets.cuda()

    return features, targets


def build_benchmark_model(
    device: str | torch.device = "cpu",
) -> CandidateTabularMLP:
    """Build and initialize CandidateTabularMLP on requested device."""
    target = torch.device(device)
    model = CandidateTabularMLP(input_dim=len(CANDIDATE_MODEL_INPUT_FEATURES))
    if target.type == "cuda" and torch.cuda.is_available():
        model = model.to(target)
    return model
