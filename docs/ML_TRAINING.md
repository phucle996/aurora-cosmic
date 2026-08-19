# AURORA Machine Learning Training & Continual Learning (Stage 6)

This document describes the reproducible training pipelines, deep neural architectures, and continual transfer learning workflows for Candidate Vetting and Astronomical Anomaly Detection.

---

## 1. Deep Neural Architectures

AURORA implements two state-of-the-art scientific deep learning models optimized for sub-microsecond inference and cross-language numerical parity:

### 1.1 Candidate Vetting (`candidate-deep-resmlp-v1`)
Supervised deep tabular classifier predicting exoplanet candidate validity (`POSITIVE` vs `NEGATIVE`):
* **Architecture**: Deep Residual Network with Squeeze-and-Excitation (SE) Feature Attention.
* **Layers**:
  1. **Feature Projection Layer**: `Linear(input_dim, 128) -> LayerNorm(128) -> GELU()`.
  2. **Residual Dense Block 1**: `Linear(128, 256) -> LayerNorm(256) -> GELU() -> Dropout(0.15) -> Linear(256, 128) -> LayerNorm(128)` with identity shortcut connection.
  3. **Feature Attention Gate (SE-Layer)**: Squeeze-and-excitation channel attention mechanism (`Linear(128, 32) -> GELU() -> Linear(32, 128) -> Sigmoid()`) modeling non-linear inter-feature dependencies.
  4. **Residual Dense Block 2**: `Linear(128, 128) -> LayerNorm(128) -> GELU() -> Dropout(0.15) -> Linear(128, 64) -> LayerNorm(64)` with shortcut projection.
  5. **Classification Head**: `Linear(64, 32) -> LayerNorm(32) -> GELU() -> Dropout(0.075) -> Linear(32, 1)` raw logit.
* **Loss Function**: `BCEWithLogitsLoss` with balanced class weights computed strictly on the TRAIN partition.
* **Optimizer**: `AdamW(lr=0.001, weight_decay=1e-4, betas=(0.9, 0.999))` coupled with `CosineAnnealingLR` scheduler (`eta_min=1e-5`).

### 1.2 Astronomical Anomaly Detection (`anomaly-deep-autoencoder-v1`)
Unsupervised tabular autoencoder learning generic light-curve feature manifolds for rare transient phenomenon discovery:
* **Architecture**: Deep Bottleneck Autoencoder with LayerNorm and GELU activations.
* **Encoder**: `input_dim (14) -> Linear(64) -> LayerNorm -> GELU -> Linear(32) -> LayerNorm -> GELU -> Linear(16) -> LayerNorm` (16-dim latent bottleneck).
* **Decoder**: `16 -> Linear(32) -> LayerNorm -> GELU -> Linear(64) -> LayerNorm -> GELU -> Linear(input_dim)`.
* **Anomaly Metric**: Reconstruction Mean Squared Error (MSE) in standardized feature space.

---

## 2. Continual Transfer Learning (Progressive Fine-Tuning)

AURORA supports continual learning across successive Gold Lakehouse Snapshots without catastrophic forgetting:
* **Base Model Selection**: Operators can initialize training from the current **👑 Champion Model**, any specific registered model, or start from scratch (`random weights`).
* **Weight Transfer**: Model weights (`state_dict`) are loaded into the target architecture prior to optimization.
* **Accuracy Compounding**: As new sectors and Gold snapshots arrive, fine-tuning preserves previously learned astrophysical representations while adapting to new observational conditions.

```
┌────────────────────────────────────────────────────────────────────────┐
│              CONTINUAL TRANSFER LEARNING WORKFLOW                      │
└────────────────────────────────────────────────────────────────────────┘
  [Gold Snapshot Sector 42] ──► [Train Scratch]  ──► [👑 Champion v1]
                                                          │
                                      (Weight Transfer)   │
                                                          ▼
  [Gold Snapshot Sector 43] ──► [Fine-tune Base] ──► [👑 Champion v2]
                                                          │
                                      (Weight Transfer)   │
                                                          ▼
  [Gold Snapshot Sector 44] ──► [Fine-tune Base] ──► [👑 Champion v3]
                                (Progressive Accuracy & ROC-AUC Compounding)
```

---

## 3. Input Isolation & Data Provenance

All training operates strictly from **committed Gold snapshots**:
* **Candidate Training**: Sourced from `gold_candidate_v1` features in Apache Parquet format.
* **Anomaly Training**: Sourced from `gold_anomaly_v1` features.
* **Zero Bronze / Silver Reads**: The pipeline performs zero Bronze raw object reads and zero Silver reads during training. Training succeeds even when Bronze objects are archived or pruned.
* **Deterministic Group Splitting**: Deterministic hash-based train/val/test splitting ensures zero group-key leakage across stellar targets.

---

## 4. Training vs Evaluation Metrics

* **Phase 6.2 & 6.3 VALIDATION Metrics**:
  * Calculated on the VALIDATION split during training.
  * Used solely for early stopping and threshold selection.
  * Are **development metrics**, NOT final benchmark claims.
* **Phase 6.4 GOLDEN TEST Metrics**:
  * Calculated strictly on unseen Golden Test cohorts.
  * Never exposed during training or threshold tuning.
