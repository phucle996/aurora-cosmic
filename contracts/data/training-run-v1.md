# Data Contract: `training-run-v1`

## Schema Overview

- **Contract Name**: `training-run-v1`
- **Schema Version**: `1`
- **Domain**: Machine Learning Training Run Artifact & Manifest Specification
- **Owner**: `python-ml-worker`
- **Consumer**: `python-ml-worker`, `rust-inference`, Model Registry

---

## 1. Storage Location & Naming Convention

Training run artifacts are stored in MinIO or local filesystem under:

```text
training-runs/candidate/<training_run_id>/
├── manifest.json
├── model.pt
├── preprocessing.json
└── metrics.json
```

Where:
- `training_run_id`: `run-cand-v1-<sha256_12_hex>` (unique execution identifier)
- `manifest.json`: Immutable metadata manifest for the completed training run
- `model.pt`: Native PyTorch saved model weights
- `preprocessing.json`: Serialized preprocessor state (imputation medians, standard scaler means/scales, feature order)
- `metrics.json`: Development metrics evaluated on the VALIDATION split

---

## 2. Training Run Manifest (`manifest.json`) Schema

```json
{
  "schema_version": 1,
  "training_run_id": "run-cand-v1-a1b2c3d4e5f6",
  "training_spec_fingerprint": "7f8a9b0c...",
  "model_version": "candidate-tabular-mlp-v1",
  "preprocessing_version": "candidate-preprocess-v1",
  "gold_snapshot_id": "gold-v1-abc123def456",
  "gold_manifest_sha256": "1234567890abcdef...",
  "split_id": "split-v1-9876543210fe",
  "split_manifest_sha256": "fedcba0987654321...",
  "dataset_view_version": "candidate-ml-view-v1",
  "dataset_view_fingerprint": "abcdef123456...",
  "feature_order": [
    "bls_available",
    "bls_depth",
    "..."
  ],
  "training_seed": 42,
  "hyperparameters": {
    "batch_size": 64,
    "early_stopping_patience": 10,
    "hidden_dims": [64, 32],
    "learning_rate": 0.001,
    "max_epochs": 100,
    "weight_decay": 0.0001
  },
  "counts": {
    "supervised_eligible_count": 1200,
    "train_row_count": 960,
    "train_positive_count": 480,
    "train_negative_count": 480,
    "validation_row_count": 240,
    "val_positive_count": 120,
    "val_negative_count": 120
  },
  "best_epoch": 34,
  "artifacts": {
    "model_pt_sha256": "e3b0c44298fc1c14...",
    "preprocessing_json_sha256": "4a5b6c...",
    "metrics_json_sha256": "7d8e9f..."
  },
  "created_at": "2026-08-08T12:00:00Z",
  "producer": "python-ml-worker"
}
```

---

## 3. Specification Fingerprint Formula (`training_spec_fingerprint`)

The `training_spec_fingerprint` uniquely identifies the exact deterministic spec of the training setup.

$$\text{digest} = \text{SHA256}(\text{Canonical JSON of Spec Object})$$

Spec canonical JSON keys:
1. `dataset_view_fingerprint`
2. `feature_order` (sorted list)
3. `gold_snapshot_id`
4. `hyperparameters` (sorted dict)
5. `model_version`
6. `preprocessing_version`
7. `split_id`
8. `training_seed`

Wall-clock timestamps, run execution hostnames, log levels, and local filesystem paths are strictly **excluded** from `training_spec_fingerprint`.

---

## 4. Preprocessor State Schema (`preprocessing.json`)

```json
{
  "schema_version": 1,
  "preprocessing_version": "candidate-preprocess-v1",
  "split_id": "split-v1-9876543210fe",
  "feature_order": [
    "bls_available",
    "..."
  ],
  "feature_medians": {
    "bls_depth": 0.015,
    "teff": 5780.0
  },
  "feature_means": {
    "bls_depth": 0.0142,
    "teff": 5650.0
  },
  "feature_scales": {
    "bls_depth": 0.005,
    "teff": 450.0
  },
  "label_encoding": {
    "NEGATIVE": 0,
    "POSITIVE": 1
  }
}
```

---

## 5. Development Metrics Schema (`metrics.json`)

```json
{
  "schema_version": 1,
  "split_evaluated": "VALIDATION",
  "validation_loss": 0.2314,
  "validation_pr_auc": 0.9123,
  "validation_roc_auc": 0.9456,
  "diagnostic_metrics_at_0_5": {
    "confusion_matrix": {
      "fn": 5,
      "fp": 8,
      "tn": 112,
      "tp": 115
    },
    "f1_score": 0.9465,
    "precision": 0.9350,
    "recall": 0.9583
  },
  "best_epoch": 34
}
```

---

## 6. Recovery Checkpoint Lifecycle (`checkpoints/ml-training/candidate/<run_id>.json`)

Training runs manage progress via state transitions:
1. `PLANNED` — training spec validated, checkpoint created
2. `TRAINING` — training loop running
3. `ARTIFACT_STORED` — `model.pt`, `preprocessing.json`, `metrics.json` written to MinIO/local storage
4. `COMPLETED` — `manifest.json` written and verified
5. `FAILED` — run failed with terminal error

Crash Recovery Policy:
- A crash in `TRAINING` state permits restarting training from epoch 0.
- A crash in `ARTIFACT_STORED` permits writing `manifest.json` without retraining.
- A `COMPLETED` state without a valid `manifest.json` artifact is untrusted.
