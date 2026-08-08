# AURORA Machine Learning Evaluation (Phase 6.4)

This document describes the evaluation architecture, cohort definitions, decision threshold selection, and performance metrics for AURORA ML models.

---

## 1. Core Evaluation Principle

Evaluation in AURORA operates on strictly unseen target groups:

```text
TRAIN / VALIDATION
    May influence model weights, preprocessing parameters, and early stopping.

GOLDEN TEST
    Must NEVER influence model weights, preprocessing parameters, or threshold tuning.

RECENT HOLDOUT
    Must NEVER influence the model being evaluated. Evaluates temporal generalization.
```

AURORA enforces complete target-level grouping isolation: any target TIC exposed during development cannot participate in Golden Test or Recent Holdout benchmarks.

---

## 2. Evaluation Cohorts (`ml-evaluation-cohort-v1`)

Evaluation cohorts are immutable datasets stored under:
```text
evaluations/cohorts/<task>/<kind>/<cohort-id>/manifest.json
```

### Cohort Policies
1. **Candidate Golden Cohort (`candidate-golden-unseen-v1`)**:
   * Sourced from a committed Gold candidate snapshot.
   * Excludes all TRAIN and VALIDATION target groups from the training split.
   * Requires $\ge 1$ POSITIVE and $\ge 1$ NEGATIVE instance for supervised metrics.
2. **Candidate Recent Holdout (`candidate-recent-sector-v1`)**:
   * Filters observations where `sector > training_max_sector`.
   * Excludes all TRAIN, VALIDATION, and Golden target groups.
3. **Anomaly Golden Cohort (`anomaly-golden-unseen-v1`)**:
   * Sourced from a committed Gold anomaly snapshot.
   * Excludes all TRAIN and VALIDATION target groups.
   * Unsupervised (no labels required).
4. **Anomaly Recent Holdout (`anomaly-recent-sector-v1`)**:
   * Filters observations where `sector > training_max_sector`.
   * Excludes all TRAIN, VALIDATION, and Golden target groups.

---

## 3. Decision Threshold Selection

Thresholds are selected **strictly on the VALIDATION set**:

* **Candidate Vetting (`candidate-threshold-max-f1-v1`)**:
  * Evaluates F1 across unique validation probability thresholds.
  * Tie-breaking:
    1. Maximum F1 score
    2. Higher recall (favors sensitivity in candidate detection)
    3. Higher precision
    4. Lower threshold value
* **Anomaly Detection (`anomaly-threshold-validation-p99-v1`)**:
  * Linear $p99$ quantile of validation reconstruction MSE scores:
    $$\text{threshold} = \text{quantile}(\text{scores}_{\text{val}}, 0.99, \text{method}="linear")$$

---

## 4. Evaluation Metrics (`model-evaluation-v1`)

### Candidate Vetting Metrics
* **PR-AUC (Average Precision)**: Primary continuous ranking metric.
* **ROC-AUC**: Secondary continuous ranking metric.
* **Threshold Metrics**: Precision, Recall, F1, Confusion Matrix ($[[TN, FP], [FN, TP]]$).
* **Drift Summary**: Metric differences between Recent Holdout and Golden Test.

### Anomaly Detection Metrics
* **Golden Reference Alert Rate**: Fraction of unmodified reference rows with $\text{score} \ge \text{threshold}$.
* **Score Distribution**: Mean, median, $p95$, $p99$, max reconstruction error.
* **Synthetic Shift Evaluation (`anomaly-synthetic-standardized-shift-v1`)**:
  * In standardized space, injects a deterministic $+6.0\sigma$ perturbation on feature index:
    $$\text{feature\_index} = \text{uint64}(\text{sha256}(\text{source\_product\_id})[:8]) \pmod{\text{input\_dim}}$$
  * Computes **`golden_synthetic_detection_rate`** (fraction of perturbed rows with $\text{score} \ge \text{threshold}$) as a mechanical sanity test.

---

## 5. Artifact Storage

Each evaluation run produces three sibling artifacts under `evaluations/runs/<task>/<evaluation-run-id>/`:
1. `threshold.json`: Exact decision threshold and validation selection metadata.
2. `metrics.json`: Detailed evaluation metrics on Golden Test and Recent Holdout.
3. `manifest.json`: Immutable run manifest linking training run and evaluation cohorts.
