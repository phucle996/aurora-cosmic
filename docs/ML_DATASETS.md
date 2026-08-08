# Stage 6 ML Datasets, Feature Allowlist & Group-Safe Splitting

## Overview

This document specifies the dataset boundary, feature selection rules, target grouping policies, and split manifest persistence contracts for **Stage 6 — ML Platform & Model Evolution**.

---

## 1. Canonical ML Input Boundary

Machine learning model training in AURORA MUST consume an explicit, committed MinIO Gold snapshot (`gold/snapshots/<snapshot-id>/manifest.json` + Gold Parquet artifacts).

Stage 6 ML training CANNOT:
- Scan raw FITS files from MinIO Bronze (`bronze/`)
- Scan preprocessed Silver Parquet files directly (`silver/`)
- Query ClickHouse analytical tables directly for training
- Perform live MAST/NASA API network requests

---

## 2. Dataset View Contract (`candidate-ml-view-v1`)

A model-specific dataset view extracts row views and model-input features from a committed Gold Candidate snapshot (`gold-candidate-v1`).

## Dataset Partition Boundaries & Permitted Uses

| Dataset Partition | Role | Permitted Use | Forbidden Use |
|---|---|---|---|
| **TRAIN** | Model Training | Fit model weights, learn preprocessing scales/medians | Threshold tuning, final performance claims |
| **VALIDATION** | Model Development | Early stopping, decision threshold selection | Weight fitting, scaling parameter fitting |
| **GOLDEN TEST** | Fixed Benchmark | Final unseen performance evaluation | Model fitting, threshold selection, architecture tuning |
| **RECENT HOLDOUT** | Temporal Generalization | Freshness and temporal drift evaluation | Model fitting, threshold selection |

### Group Isolation Invariant
All splits and evaluation cohorts enforce target-level grouping (`tic:<id>`). A target group exposed during TRAIN or VALIDATION is contaminated and CAN NEVER participate in GOLDEN TEST or RECENT HOLDOUT.

### Column Role Boundaries & Leakage Exclusion

Gold Candidate datasets classify columns into 5 distinct roles:
1. `IDENTITY`: `source_product_id`, `lineage_id`, `sample_id`, `tic_id`, `sector`, `silver_sha256`, `lc_feature_version`, `lc_feature_fingerprint`
2. `MODEL_INPUT`: 32 scientific features (statistics, BLS parameters, spatial TPF evidence, TIC stellar parameters)
3. `VETTING_CONTEXT`: `toi_match_status`, `tce_match_status`
4. `AUDIT`: `matched_toi_id`, `toi_period_error`, `matched_tce_id`, `label_policy_version`
5. `SUPERVISION`: `training_label`

Feature matrices passed to ML training algorithms MUST select ONLY columns classified as `MODEL_INPUT` in a frozen, deterministic order (32 columns). Columns tagged `IDENTITY`, `VETTING_CONTEXT`, `AUDIT`, or `SUPERVISION` are strictly excluded from model input features.

---

## 3. Supervision Label Eligibility Policy

Gold Candidate datasets contain 4 conservative label states:
- `POSITIVE`: Known confirmed planets -> Supervised eligible (binary target `y = 1`)
- `NEGATIVE`: Explicit false positives -> Supervised eligible (binary target `y = 0`)
- `UNRESOLVED`: Candidate / unresolved targets -> NOT supervised eligible (`UNRESOLVED != NEGATIVE`)
- `EXCLUDED`: Excluded targets -> NOT supervised eligible

> **Critical Rule**: `UNRESOLVED` targets MUST NOT be coerced into negative samples during supervised binary training. Unresolved targets remain preserved in Gold and are used for inference, ranking, and future relabeling.

---

## 4. Group-Safe Split Policy (`candidate-group-split-v1`)

### Target Grouping Rule
To prevent data leakage across observing sectors, all observations belonging to the same astronomical target MUST belong to the exact same split set (Train or Validation):

```text
group_key = "tic:<tic_id>"            (when tic_id is available)
group_key = "source:<source_product_id>"  (fallback when tic_id is missing)
```

Multi-sector observations for `TIC 12345678` across sectors 10, 11, and 12 will always be assigned 100% to Train or 100% to Validation.

### Deterministic Hash Assignment
Target groups are mapped into split buckets via SHA-256 digest:
```text
SHA256("candidate-group-split-v1" + ":" + seed + ":" + group_key)
```
- Buckets `0 .. 7999` (80%) -> `TRAIN`
- Buckets `8000 .. 9999` (20%) -> `VALIDATION`

---

## 5. Immutable Split Manifests (`ml-split-v1`)

Split assignments are validated and persisted as immutable JSON artifacts at:
```text
manifests/ml-splits/<split-id>.json
```

Once written, a split manifest cannot be altered. Re-running the split with identical inputs reuses the manifest idempotently.
