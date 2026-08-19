"""Candidate Vetting Model Training Engine (Phase 6.2).

Executes reproducible exoplanet-candidate vetting tabular model training.
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

from aurora_ml.ml.candidate.checkpoint import (
    TrainingRunCheckpoint,
    TrainingRunManifest,
    TrainingRunSpec,
)
from aurora_ml.ml.candidate.model import CandidateTabularMLP
from aurora_ml.ml.candidate.preprocessor import CandidatePreprocessor
from aurora_ml.ml.datasets.splits import (
    CANDIDATE_MODEL_INPUT_FEATURES,
    CandidateGroupSplit,
    derive_group_key,
)
from aurora_ml.ml.device import require_cuda
from aurora_ml.pipeline.gold import GoldSnapshotManifest


class CandidateTrainingError(Exception):
    """Base exception for candidate model training failures."""

    pass


def calculate_binary_metrics(
    y_true: np.ndarray, y_prob: np.ndarray, threshold: float = 0.5
) -> Dict[str, Any]:
    """Calculate diagnostic binary classification metrics (PR-AUC, ROC-AUC, F1, Precision, Recall, Confusion Matrix)."""
    y_true_flat = y_true.flatten().astype(int)
    y_prob_flat = y_prob.flatten()

    # Diagnostic threshold metrics
    preds = (y_prob_flat >= threshold).astype(int)
    tp = int(np.sum((preds == 1) & (y_true_flat == 1)))
    fp = int(np.sum((preds == 1) & (y_true_flat == 0)))
    tn = int(np.sum((preds == 0) & (y_true_flat == 0)))
    fn = int(np.sum((preds == 0) & (y_true_flat == 1)))

    precision = float(tp / (tp + fp)) if (tp + fp) > 0 else 0.0
    recall = float(tp / (tp + fn)) if (tp + fn) > 0 else 0.0
    f1 = (
        float(2 * precision * recall / (precision + recall))
        if (precision + recall) > 0
        else 0.0
    )

    # Trapezoid ROC-AUC
    # Sort by descending probability score
    order = np.argsort(-y_prob_flat)
    y_sorted = y_true_flat[order]

    n_pos = np.sum(y_true_flat == 1)
    n_neg = np.sum(y_true_flat == 0)

    if n_pos == 0 or n_neg == 0:
        roc_auc = 0.5
        pr_auc = float(n_pos / (n_pos + n_neg)) if (n_pos + n_neg) > 0 else 0.0
    else:
        # ROC-AUC calculation
        tpr_list = [0.0]
        fpr_list = [0.0]
        cum_tp = 0
        cum_fp = 0
        for y_val in y_sorted:
            if y_val == 1:
                cum_tp += 1
            else:
                cum_fp += 1
            tpr_list.append(cum_tp / n_pos)
            fpr_list.append(cum_fp / n_neg)
        roc_auc = float(np.trapezoid(tpr_list, fpr_list))

        # PR-AUC calculation
        prec_list = [1.0]
        rec_list = [0.0]
        cum_tp = 0
        cum_fp = 0
        for i, y_val in enumerate(y_sorted):
            if y_val == 1:
                cum_tp += 1
            else:
                cum_fp += 1
            prec_list.append(cum_tp / (cum_tp + cum_fp))
            rec_list.append(cum_tp / n_pos)
        # Sort by recall ascending for integration
        rec_arr = np.array(rec_list)
        prec_arr = np.array(prec_list)
        sort_rec_idx = np.argsort(rec_arr)
        pr_auc = float(np.trapezoid(prec_arr[sort_rec_idx], rec_arr[sort_rec_idx]))

    return {
        "validation_pr_auc": pr_auc,
        "validation_roc_auc": roc_auc,
        "diagnostic_metrics_at_0_5": {
            "confusion_matrix": {"tp": tp, "fp": fp, "tn": tn, "fn": fn},
            "precision": precision,
            "recall": recall,
            "f1_score": f1,
        },
    }


def train_candidate_model(
    gold_manifest: GoldSnapshotManifest,
    split_manifest: CandidateGroupSplit,
    rows: List[Dict[str, Any]],
    training_seed: int = 42,
    epochs: int = 50,
    batch_size: int = 64,
    learning_rate: float = 0.001,
    weight_decay: float = 0.0001,
    early_stopping_patience: int = 10,
    dest_dir: Optional[str] = None,
    device_str: str = "cuda",
    max_vram_mb: int = 0,
    base_model_path: Optional[str] = None,
) -> Tuple[TrainingRunManifest, TrainingRunCheckpoint]:
    """Execute Phase 6.2 Candidate Tabular Model Training Run.

    Accepts committed Gold manifest, split manifest, and rows dataset.
    Supports transfer learning and continual fine-tuning from a base model.
    """
    # 1. Preflight Validations
    gold_manifest.validate()
    if split_manifest.schema_version != 1:
        raise CandidateTrainingError(
            "INVALID_SPLIT_MANIFEST_SCHEMA: Unsupported split manifest schema version"
        )

    if split_manifest.gold_snapshot_id != gold_manifest.snapshot_id:
        raise CandidateTrainingError(
            f"SPLIT_GOLD_MISMATCH: Split snapshot ID '{split_manifest.gold_snapshot_id}' != Gold snapshot ID '{gold_manifest.snapshot_id}'"
        )

    gold_manifest_sha = hashlib.sha256(
        json.dumps(
            gold_manifest.to_dict(), sort_keys=True, separators=(",", ":")
        ).encode("utf-8")
    ).hexdigest()
    if split_manifest.gold_manifest_sha256 != gold_manifest_sha:
        raise CandidateTrainingError(
            f"GOLD_MANIFEST_SHA_MISMATCH: Split recorded SHA '{split_manifest.gold_manifest_sha256}' != actual Gold SHA '{gold_manifest_sha}'"
        )

    # Revalidate group disjointness between TRAIN and VALIDATION
    train_groups = {
        a.group_key for a in split_manifest.assignments if a.split == "TRAIN"
    }
    val_groups = {
        a.group_key for a in split_manifest.assignments if a.split == "VALIDATION"
    }
    if train_groups.intersection(val_groups):
        raise CandidateTrainingError(
            "TRAIN_VAL_GROUP_LEAKAGE: Same group key detected in both TRAIN and VALIDATION"
        )

    # Map split assignments
    assignment_map = {a.group_key: a.split for a in split_manifest.assignments}

    # Partition supervised eligible rows into TRAIN and VALIDATION
    train_rows: List[Dict[str, Any]] = []
    val_rows: List[Dict[str, Any]] = []

    for r in rows:
        label = r.get("training_label")
        if label not in ("POSITIVE", "NEGATIVE"):
            continue  # Exclude UNRESOLVED / EXCLUDED

        gk = derive_group_key(r)
        assigned_split = assignment_map.get(gk)
        if assigned_split == "TRAIN":
            train_rows.append(r)
        elif assigned_split == "VALIDATION":
            val_rows.append(r)

    if not train_rows or not val_rows:
        raise CandidateTrainingError(
            "EMPTY_SPLIT_PARTITION: TRAIN or VALIDATION partition contains 0 supervised rows"
        )

    # 2. Spec & Recovery Checkpoint Initialization
    hyperparams = {
        "batch_size": batch_size,
        "early_stopping_patience": early_stopping_patience,
        "hidden_dims": [64, 32],
        "learning_rate": learning_rate,
        "max_epochs": epochs,
        "weight_decay": weight_decay,
        "device": "cuda",
        "amp_dtype": "float16",
        "fine_tune_base_model": bool(base_model_path),
    }

    # Derive dataset_view_fingerprint from preprocessor feature order
    view_fp_payload = json.dumps(
        {"feature_names": list(CANDIDATE_MODEL_INPUT_FEATURES)}, sort_keys=True
    )
    dataset_view_fp = hashlib.sha256(view_fp_payload.encode("utf-8")).hexdigest()

    # 3. Seed Randomness
    random.seed(training_seed)
    np.random.seed(training_seed)
    torch.manual_seed(training_seed)

    # Device selection is deliberately strict: there is no CPU training path.
    try:
        device, cuda_info = require_cuda(device_str, max_vram_mb)
    except Exception as exc:
        raise CandidateTrainingError(str(exc)) from exc
    hyperparams["cuda_runtime"] = cuda_info.to_dict()

    spec = TrainingRunSpec(
        gold_snapshot_id=gold_manifest.snapshot_id,
        split_id=split_manifest.split_id,
        dataset_view_fingerprint=dataset_view_fp,
        training_seed=training_seed,
        hyperparameters=hyperparams,
    )
    checkpoint = TrainingRunCheckpoint(
        training_run_id=spec.training_run_id,
        training_spec_fingerprint=spec.training_spec_fingerprint,
        status="PLANNED",
        gold_snapshot_id=gold_manifest.snapshot_id,
        split_id=split_manifest.split_id,
    )

    # 4. Preprocessing Fit (TRAIN only)
    preprocessor = CandidatePreprocessor(split_id=split_manifest.split_id)
    preprocessor.fit(train_rows, split_id=split_manifest.split_id)

    X_train_np = preprocessor.transform_features(train_rows)
    y_train_np = preprocessor.transform_labels(train_rows)
    X_val_np = preprocessor.transform_features(val_rows)
    y_val_np = preprocessor.transform_labels(val_rows)

    X_train_t = torch.from_numpy(X_train_np).to(torch.float32)
    y_train_t = torch.from_numpy(y_train_np).to(torch.float32)
    X_val_t = torch.from_numpy(X_val_np).to(torch.float32)
    y_val_t = torch.from_numpy(y_val_np).to(torch.float32)

    # Compute balanced pos_weight strictly on TRAIN set
    n_pos_train = int(np.sum(y_train_np == 1.0))
    n_neg_train = int(np.sum(y_train_np == 0.0))
    if n_pos_train == 0 or n_neg_train == 0:
        raise CandidateTrainingError(
            "SINGLE_CLASS_TRAIN_SPLIT: TRAIN set must contain both POSITIVE and NEGATIVE rows"
        )

    pos_weight = torch.tensor([n_neg_train / n_pos_train], dtype=torch.float32).to(
        device
    )
    loss_fn = nn.BCEWithLogitsLoss(pos_weight=pos_weight)

    # DataLoaders
    g = torch.Generator()
    g.manual_seed(training_seed)
    train_dataset = TensorDataset(X_train_t, y_train_t)
    val_dataset = TensorDataset(X_val_t, y_val_t)

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
    model = CandidateTabularMLP(
        input_dim=len(CANDIDATE_MODEL_INPUT_FEATURES),
        hidden_dims=(64, 32),
        dropout_rate=0.2,
    ).to(device)

    # Load base model weights for fine-tuning if provided
    if base_model_path and os.path.exists(base_model_path):
        try:
            state_dict = torch.load(base_model_path, map_location=device, weights_only=True)
            model.load_state_dict(state_dict, strict=False)
            print(f"[aurora-ml] Transfer Learning: Initialized CandidateTabularMLP with base weights from {base_model_path}")
        except Exception as exc:
            print(f"[aurora-ml] Warning: Could not load base weights: {exc}. Training with random init.")

    optimizer = torch.optim.AdamW(
        model.parameters(), lr=learning_rate, weight_decay=weight_decay, betas=(0.9, 0.999)
    )
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs, eta_min=1e-5)

    checkpoint.update_status("TRAINING")
    checkpoint_path = os.path.join(
        "checkpoints", "ml-training", "candidate", f"{spec.training_run_id}.json"
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
        for batch_x, batch_y in train_loader:
            batch_x = batch_x.to(device, non_blocking=True)
            batch_y = batch_y.to(device, non_blocking=True)
            optimizer.zero_grad(set_to_none=True)
            with torch.autocast(device_type="cuda", dtype=torch.float16):
                logits = model(batch_x)
                loss = loss_fn(logits, batch_y)
            scaler.scale(loss).backward()
            scaler.step(optimizer)
            scaler.update()

        scheduler.step()

        # Evaluate on VALIDATION split
        model.eval()
        val_loss_sum = 0.0
        val_count = 0
        with torch.no_grad():
            for batch_x, batch_y in val_loader:
                batch_x = batch_x.to(device, non_blocking=True)
                batch_y = batch_y.to(device, non_blocking=True)
                with torch.autocast(device_type="cuda", dtype=torch.float16):
                    logits = model(batch_x)
                    loss = loss_fn(logits, batch_y)
                val_loss_sum += float(loss.item()) * len(batch_y)
                val_count += len(batch_y)

        val_loss = val_loss_sum / val_count if val_count > 0 else float("inf")

        if val_loss < best_val_loss:
            best_val_loss = val_loss
            best_epoch = epoch
            best_model_state = {
                k: v.cpu().clone() for k, v in model.state_dict().items()
            }
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

    # 7. Evaluate Final Best Model on VALIDATION split
    model.eval()
    val_preds_list: List[np.ndarray] = []
    with torch.no_grad():
        for batch_x, _ in val_loader:
            batch_x = batch_x.to(device, non_blocking=True)
            with torch.autocast(device_type="cuda", dtype=torch.float16):
                logits = model(batch_x)
            probs = torch.sigmoid(logits).cpu().numpy()
            val_preds_list.append(probs)

    y_val_probs = np.vstack(val_preds_list)
    val_metrics = calculate_binary_metrics(y_val_np, y_val_probs)
    val_metrics["validation_loss"] = best_val_loss
    val_metrics["best_epoch"] = best_epoch
    val_metrics["schema_version"] = 1
    val_metrics["split_evaluated"] = "VALIDATION"

    # 8. Artifact Serialization & Manifest
    output_dir = dest_dir or os.path.join(
        "training-runs", "candidate", spec.training_run_id
    )
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
    metrics_json_str = json.dumps(val_metrics, indent=2)
    metrics_json_path = os.path.join(output_dir, "metrics.json")
    with open(metrics_json_path, "w", encoding="utf-8") as f:
        f.write(metrics_json_str)
    metrics_json_sha = hashlib.sha256(metrics_json_str.encode("utf-8")).hexdigest()

    checkpoint.update_status("ARTIFACT_STORED")

    # Build TrainingRunManifest
    split_manifest_sha = hashlib.sha256(
        json.dumps(
            split_manifest.to_dict(), sort_keys=True, separators=(",", ":")
        ).encode("utf-8")
    ).hexdigest()

    manifest = TrainingRunManifest(
        training_run_id=spec.training_run_id,
        training_spec_fingerprint=spec.training_spec_fingerprint,
        model_version=spec.model_version,
        preprocessing_version=spec.preprocessing_version,
        gold_snapshot_id=gold_manifest.snapshot_id,
        gold_manifest_sha256=gold_manifest_sha,
        split_id=split_manifest.split_id,
        split_manifest_sha256=split_manifest_sha,
        dataset_view_version="candidate-ml-view-v1",
        dataset_view_fingerprint=dataset_view_fp,
        feature_order=list(CANDIDATE_MODEL_INPUT_FEATURES),
        training_seed=training_seed,
        hyperparameters=hyperparams,
        counts={
            "supervised_eligible_count": len(train_rows) + len(val_rows),
            "train_row_count": len(train_rows),
            "train_positive_count": n_pos_train,
            "train_negative_count": n_neg_train,
            "validation_row_count": len(val_rows),
            "val_positive_count": int(np.sum(y_val_np == 1.0)),
            "val_negative_count": int(np.sum(y_val_np == 0.0)),
        },
        best_epoch=best_epoch,
        artifacts={
            "model_pt_sha256": model_pt_sha,
            "preprocessing_json_sha256": prep_json_sha,
            "metrics_json_sha256": metrics_json_sha,
        },
    )

    manifest_path = os.path.join(output_dir, "manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as f:
        f.write(manifest.to_json())

    checkpoint.update_status("COMPLETED")

    # Save recovery checkpoint file
    with open(checkpoint_path, "w", encoding="utf-8") as f:
        f.write(checkpoint.to_json())

    return manifest, checkpoint
