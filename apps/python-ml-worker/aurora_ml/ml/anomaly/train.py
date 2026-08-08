"""Anomaly Autoencoder Model Training Engine (Phase 6.3).

Executes reproducible, target-group-safe unsupervised anomaly model training.
"""

import hashlib
import json
import os
import random
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset

from aurora_ml.ml.anomaly.checkpoint import (
    AnomalyTrainingRunCheckpoint,
    AnomalyTrainingRunManifest,
    AnomalyTrainingRunSpec,
)
from aurora_ml.ml.anomaly.model import (
    AnomalyLightcurveAutoencoder,
    compute_reconstruction_mse,
)
from aurora_ml.ml.anomaly.preprocessor import (
    ANOMALY_MODEL_INPUT_FEATURES,
    AnomalyPreprocessor,
)
from aurora_ml.ml.datasets.splits import CandidateGroupSplit, derive_group_key
from aurora_ml.ml.device import require_cuda
from aurora_ml.pipeline.gold import GoldSnapshotManifest


class AnomalyTrainingError(Exception):
    """Base exception for anomaly training execution failures."""
    pass


def train_anomaly_model(
    gold_manifest: GoldSnapshotManifest,
    split_manifest: CandidateGroupSplit,
    rows: List[Dict[str, Any]],
    training_seed: int = 42,
    epochs: int = 150,
    batch_size: int = 64,
    learning_rate: float = 0.001,
    weight_decay: float = 0.00001,
    early_stopping_patience: int = 15,
    dest_dir: Optional[str] = None,
    device_str: str = "cuda",
    max_vram_mb: int = 0,
) -> Tuple[AnomalyTrainingRunManifest, AnomalyTrainingRunCheckpoint]:
    """Execute Phase 6.3 Anomaly Light-Curve Autoencoder Training Run.

    Accepts committed Gold manifest, split manifest, and rows dataset.
    Fits preprocessor strictly on TRAIN split.
    Saves model.pt, preprocessing.json, metrics.json, manifest.json.
    """
    # 1. Preflight Validations
    gold_manifest.validate()
    if split_manifest.schema_version != 1:
        raise AnomalyTrainingError("INVALID_SPLIT_MANIFEST_SCHEMA: Unsupported split manifest schema version")

    if split_manifest.gold_snapshot_id != gold_manifest.snapshot_id:
        raise AnomalyTrainingError(
            f"SPLIT_GOLD_MISMATCH: Split snapshot ID '{split_manifest.gold_snapshot_id}' != Gold snapshot ID '{gold_manifest.snapshot_id}'"
        )

    gold_manifest_sha = hashlib.sha256(
        json.dumps(gold_manifest.to_dict(), sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    if split_manifest.gold_manifest_sha256 != gold_manifest_sha:
        raise AnomalyTrainingError(
            f"GOLD_MANIFEST_SHA_MISMATCH: Split recorded SHA '{split_manifest.gold_manifest_sha256}' != actual Gold SHA '{gold_manifest_sha}'"
        )

    # Build group assignment mapping
    assignment_map = {a.group_key: a.split for a in split_manifest.assignments}

    # Partition rows into TRAIN and VALIDATION
    train_rows: List[Dict[str, Any]] = []
    val_rows: List[Dict[str, Any]] = []

    for r in rows:
        gkey = derive_group_key(r)
        assigned_split = assignment_map.get(gkey)
        if assigned_split == "TRAIN":
            train_rows.append(r)
        elif assigned_split == "VALIDATION":
            val_rows.append(r)

    if not train_rows:
        raise AnomalyTrainingError("EMPTY_TRAIN_SPLIT: TRAIN partition contains 0 rows")
    if not val_rows:
        raise AnomalyTrainingError("EMPTY_VAL_SPLIT: VALIDATION partition contains 0 rows")

    # Revalidate TIC disjointness
    train_tics = {r.get("tic_id") for r in train_rows if r.get("tic_id") is not None}
    val_tics = {r.get("tic_id") for r in val_rows if r.get("tic_id") is not None}
    overlap = train_tics.intersection(val_tics)
    if overlap:
        raise AnomalyTrainingError(f"TIC_LEAKAGE_DETECTED: Targets present in both splits: {overlap}")

    # 2. Spec & Recovery Checkpoint Initialization
    hyperparams = {
        "batch_size": batch_size,
        "early_stopping_patience": early_stopping_patience,
        "hidden_dims": [32, 8],
        "learning_rate": learning_rate,
        "max_epochs": epochs,
        "weight_decay": weight_decay,
        "device": "cuda",
        "amp_dtype": "float16",
    }

    view_fp_payload = json.dumps({"feature_names": list(ANOMALY_MODEL_INPUT_FEATURES)}, sort_keys=True)
    dataset_view_fp = hashlib.sha256(view_fp_payload.encode("utf-8")).hexdigest()

    # 3. Seed Randomness
    random.seed(training_seed)
    np.random.seed(training_seed)
    torch.manual_seed(training_seed)

    # Device selection is deliberately strict: there is no CPU training path.
    try:
        device, cuda_info = require_cuda(device_str, max_vram_mb)
    except Exception as exc:
        raise AnomalyTrainingError(str(exc)) from exc
    hyperparams["cuda_runtime"] = cuda_info.to_dict()

    spec = AnomalyTrainingRunSpec(
        gold_snapshot_id=gold_manifest.snapshot_id,
        split_id=split_manifest.split_id,
        dataset_view_fingerprint=dataset_view_fp,
        training_seed=training_seed,
        hyperparameters=hyperparams,
    )
    checkpoint = AnomalyTrainingRunCheckpoint(
        training_run_id=spec.training_run_id,
        training_spec_fingerprint=spec.training_spec_fingerprint,
        status="PLANNED",
        gold_snapshot_id=gold_manifest.snapshot_id,
        split_id=split_manifest.split_id,
    )

    # 4. Preprocessing Fit (TRAIN only)
    preprocessor = AnomalyPreprocessor(split_id=split_manifest.split_id)
    preprocessor.fit(train_rows, split_id=split_manifest.split_id)

    X_train_np = preprocessor.transform_features(train_rows)
    X_val_np = preprocessor.transform_features(val_rows)

    X_train_t = torch.from_numpy(X_train_np).to(torch.float32)
    X_val_t = torch.from_numpy(X_val_np).to(torch.float32)

    loss_fn = nn.MSELoss()

    # DataLoaders
    g = torch.Generator()
    g.manual_seed(training_seed)
    train_dataset = TensorDataset(X_train_t, X_train_t)
    val_dataset = TensorDataset(X_val_t, X_val_t)

    train_loader = DataLoader(
        train_dataset,
        batch_size=batch_size,
        shuffle=True,
        generator=g,
        pin_memory=True,
    )
    val_loader = DataLoader(
        val_dataset, batch_size=batch_size, shuffle=False, pin_memory=True
    )

    # 5. Model & Optimizer Initialization
    model = AnomalyLightcurveAutoencoder(
        input_dim=len(ANOMALY_MODEL_INPUT_FEATURES),
        hidden_dims=(32, 8),
    ).to(device)

    optimizer = torch.optim.AdamW(
        model.parameters(), lr=learning_rate, weight_decay=weight_decay
    )

    checkpoint.update_status("TRAINING")
    checkpoint_path = os.path.join(
        "checkpoints", "ml-training", "anomaly", f"{spec.training_run_id}.json"
    )
    os.makedirs(os.path.dirname(checkpoint_path), exist_ok=True)
    scaler = torch.amp.GradScaler("cuda", enabled=True)

    # 6. Training Loop with Early Stopping
    best_val_loss = float("inf")
    best_epoch = 0
    best_model_state: Optional[Dict[str, Any]] = None
    patience_counter = 0

    for epoch in range(1, epochs + 1):
        model.train()
        for batch_x, _ in train_loader:
            batch_x = batch_x.to(device, non_blocking=True)
            optimizer.zero_grad(set_to_none=True)
            with torch.autocast(device_type="cuda", dtype=torch.float16):
                reconstructed = model(batch_x)
                loss = loss_fn(reconstructed, batch_x)
            scaler.scale(loss).backward()
            scaler.step(optimizer)
            scaler.update()

        # Evaluate on VALIDATION split
        model.eval()
        val_loss_sum = 0.0
        val_count = 0
        with torch.no_grad():
            for batch_x, _ in val_loader:
                batch_x = batch_x.to(device, non_blocking=True)
                with torch.autocast(device_type="cuda", dtype=torch.float16):
                    reconstructed = model(batch_x)
                    loss = loss_fn(reconstructed, batch_x)
                val_loss_sum += float(loss.item()) * len(batch_x)
                val_count += len(batch_x)

        val_loss = val_loss_sum / val_count if val_count > 0 else float("inf")

        if val_loss < best_val_loss:
            best_val_loss = val_loss
            best_epoch = epoch
            best_model_state = {k: v.cpu().clone() for k, v in model.state_dict().items()}
            patience_counter = 0
        else:
            patience_counter += 1
            if patience_counter >= early_stopping_patience:
                break

        checkpoint.current_epoch = epoch
        checkpoint.best_epoch = best_epoch
        checkpoint.best_val_loss = best_val_loss
        with open(checkpoint_path, "w", encoding="utf-8") as f:
            f.write(checkpoint.to_json())

    # Restore best model state
    if best_model_state is not None:
        model.load_state_dict(best_model_state)

    checkpoint.current_epoch = epoch
    checkpoint.best_epoch = best_epoch
    checkpoint.best_val_loss = best_val_loss

    # 7. Compute Validation Scores Summary
    model.eval()
    val_scores_list: List[np.ndarray] = []
    with torch.no_grad():
        for batch_x, _ in val_loader:
            batch_x = batch_x.to(device, non_blocking=True)
            with torch.autocast(device_type="cuda", dtype=torch.float16):
                reconstructed = model(batch_x)
            scores_t = compute_reconstruction_mse(batch_x, reconstructed)
            val_scores_list.append(scores_t.cpu().numpy())

    all_val_scores = np.concatenate(val_scores_list)

    val_score_mean = float(np.mean(all_val_scores))
    val_score_median = float(np.median(all_val_scores))
    val_score_p95 = float(np.percentile(all_val_scores, 95))
    val_score_max = float(np.max(all_val_scores))

    val_metrics = {
        "schema_version": 1,
        "split_evaluated": "VALIDATION",
        "validation_reconstruction_loss": best_val_loss,
        "validation_score_mean": val_score_mean,
        "validation_score_median": val_score_median,
        "validation_score_p95": val_score_p95,
        "validation_score_max": val_score_max,
        "best_epoch": best_epoch,
    }

    # 8. Artifact Serialization & Manifest
    output_dir = dest_dir or os.path.join("training-runs", "anomaly", spec.training_run_id)
    os.makedirs(output_dir, exist_ok=True)

    # Save model.pt
    model_pt_path = os.path.join(output_dir, "model.pt")
    # Training is GPU-only, but artifacts must remain portable to CPU export/runtime.
    cpu_state_dict = {k: v.detach().cpu() for k, v in model.state_dict().items()}
    torch.save(cpu_state_dict, model_pt_path)
    with open(model_pt_path, "rb") as f:
        model_pt_sha = hashlib.sha256(f.read()).hexdigest()

    # Save preprocessing.json
    prep_json_str = preprocessor.to_json()
    prep_json_path = os.path.join(output_dir, "preprocessing.json")
    with open(prep_json_path, "w", encoding="utf-8") as f:
        f.write(prep_json_str)
    prep_json_sha = hashlib.sha256(prep_json_str.encode("utf-8")).hexdigest()

    # Save metrics.json
    metrics_json_str = json.dumps(val_metrics, indent=2, sort_keys=True)
    metrics_json_path = os.path.join(output_dir, "metrics.json")
    with open(metrics_json_path, "w", encoding="utf-8") as f:
        f.write(metrics_json_str)
    metrics_json_sha = hashlib.sha256(metrics_json_str.encode("utf-8")).hexdigest()

    checkpoint.update_status("ARTIFACT_STORED")

    # Build AnomalyTrainingRunManifest
    split_manifest_sha = hashlib.sha256(
        json.dumps(split_manifest.to_dict(), sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()

    manifest = AnomalyTrainingRunManifest(
        training_run_id=spec.training_run_id,
        training_spec_fingerprint=spec.training_spec_fingerprint,
        task="astronomical_anomaly_detection",
        model_version=model.model_version,
        preprocessing_version=preprocessor.preprocessing_version,
        score_definition_version=model.score_definition_version,
        gold_snapshot_id=gold_manifest.snapshot_id,
        gold_manifest_sha256=gold_manifest_sha,
        split_id=split_manifest.split_id,
        split_manifest_sha256=split_manifest_sha,
        dataset_view_version="anomaly-lightcurve-ml-view-v1",
        dataset_view_fingerprint=dataset_view_fp,
        feature_order=list(ANOMALY_MODEL_INPUT_FEATURES),
        training_seed=training_seed,
        hyperparameters=hyperparams,
        train_group_count=split_manifest.train_group_count,
        validation_group_count=split_manifest.validation_group_count,
        train_row_count=len(train_rows),
        validation_row_count=len(val_rows),
        best_epoch=best_epoch,
        validation_reconstruction_loss=best_val_loss,
        validation_score_mean=val_score_mean,
        validation_score_median=val_score_median,
        validation_score_p95=val_score_p95,
        validation_score_max=val_score_max,
        model_sha256=model_pt_sha,
        preprocessing_sha256=prep_json_sha,
        metrics_sha256=metrics_json_sha,
    )

    manifest_json_path = os.path.join(output_dir, "manifest.json")
    with open(manifest_json_path, "w", encoding="utf-8") as f:
        f.write(manifest.to_json())

    checkpoint.update_status("COMPLETED")
    with open(checkpoint_path, "w", encoding="utf-8") as f:
        f.write(checkpoint.to_json())
    return manifest, checkpoint
