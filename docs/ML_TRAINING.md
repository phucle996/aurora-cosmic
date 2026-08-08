# AURORA Machine Learning Training (Stage 6)

This document describes the reproducible training pipelines for Candidate Vetting and Astronomical Anomaly Detection.

---

## 1. Pipelines Overview

AURORA implements two complementary machine learning training engines:
1. **Candidate Vetting (`candidate-tabular-mlp-v1`)**: Supervised tabular classifier predicting exoplanet candidate validity (`POSITIVE` vs `NEGATIVE`).
2. **Astronomical Anomaly Detection (`anomaly-lightcurve-autoencoder-v1`)**: Unsupervised tabular autoencoder learning generic light-curve feature distributions and producing reconstruction MSE evidence.

---

## 2. Input Isolation & Data Provenance

All training operates strictly from **committed Gold snapshots**:
* **Candidate Training**: Sourced from `gold_candidate_v1`.
* **Anomaly Training**: Sourced from `gold_anomaly_v1`.
* **Zero Bronze / Silver Reads**: The pipeline performs zero Bronze raw object reads and zero Silver reads during training. Training succeeds even when Bronze objects are in `RAW_DELETED` state.
* **Offline Independence**: Training does not require ClickHouse or NATS to be online.

---

## 3. Preprocessing Policies

* **Candidate Preprocessing (`candidate-preprocess-v1`)**:
  * Fit strictly on the **TRAIN** split.
  * TRAIN median imputation for missing values.
  * Robust feature scaling using TRAIN medians and interquartile ranges.
* **Anomaly Preprocessing (`anomaly-lightcurve-preprocess-v1`)**:
  * Fit strictly on the **TRAIN** split.
  * TRAIN median imputation.
  * Standardization (`mean`, `std`) computed from TRAIN only.

---

## 4. Training vs Evaluation Metrics

* **Phase 6.2 & 6.3 VALIDATION Metrics**:
  * Calculated on the VALIDATION split during training.
  * Used solely for early stopping and threshold selection.
  * Are **development metrics**, NOT final benchmark claims.
* **Phase 6.4 GOLDEN TEST Metrics**:
  * Calculated strictly on unseen Golden Test cohorts.
  * Never exposed during training or threshold tuning.
