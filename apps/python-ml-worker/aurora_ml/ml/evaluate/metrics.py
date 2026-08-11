"""Statistical Evaluation Metrics & Threshold Selection Math (Phase 6.4).

Implements candidate-threshold-max-f1-v1, anomaly-threshold-validation-p99-v1,
Average Precision (PR-AUC), and synthetic anomaly shift calculations.
"""

import hashlib
from typing import Any, Dict, List, Tuple

import numpy as np


def select_candidate_validation_threshold(
    y_true: np.ndarray, y_prob: np.ndarray
) -> Tuple[float, float, float, float]:
    """Select decision threshold strictly on VALIDATION set using candidate-threshold-max-f1-v1."""
    y_true_flat = y_true.flatten().astype(int)
    y_prob_flat = y_prob.flatten().astype(float)

    unique_probs = np.unique(y_prob_flat)
    candidate_thresholds = np.sort(unique_probs)

    best_thresh = 0.5
    best_f1 = -1.0
    best_rec = -1.0
    best_prec = -1.0

    for t in candidate_thresholds:
        preds = (y_prob_flat >= t).astype(int)
        tp = int(np.sum((preds == 1) & (y_true_flat == 1)))
        fp = int(np.sum((preds == 1) & (y_true_flat == 0)))
        fn = int(np.sum((preds == 0) & (y_true_flat == 1)))

        prec = float(tp / (tp + fp)) if (tp + fp) > 0 else 0.0
        rec = float(tp / (tp + fn)) if (tp + fn) > 0 else 0.0
        f1 = float(2 * prec * rec / (prec + rec)) if (prec + rec) > 0 else 0.0

        if f1 > best_f1:
            best_f1, best_rec, best_prec, best_thresh = f1, rec, prec, float(t)
        elif abs(f1 - best_f1) < 1e-9:
            if rec > best_rec:
                best_f1, best_rec, best_prec, best_thresh = f1, rec, prec, float(t)
            elif abs(rec - best_rec) < 1e-9:
                if prec > best_prec:
                    best_f1, best_rec, best_prec, best_thresh = f1, rec, prec, float(t)
                elif abs(prec - best_prec) < 1e-9:
                    if t < best_thresh:
                        best_f1, best_rec, best_prec, best_thresh = (
                            f1,
                            rec,
                            prec,
                            float(t),
                        )

    return best_thresh, best_f1, best_prec, best_rec


def compute_average_precision(y_true: np.ndarray, y_prob: np.ndarray) -> float:
    """Compute Average Precision (PR-AUC) from continuous predicted probabilities."""
    y_true_flat = y_true.flatten().astype(int)
    y_prob_flat = y_prob.flatten().astype(float)

    order = np.argsort(-y_prob_flat)
    y_true_sorted = y_true_flat[order]

    n_pos = np.sum(y_true_flat == 1)
    if n_pos == 0:
        return 0.0

    tp_cumulative = np.cumsum(y_true_sorted == 1)
    fp_cumulative = np.cumsum(y_true_sorted == 0)

    precisions = tp_cumulative / (tp_cumulative + fp_cumulative)
    ap = float(np.sum(precisions * (y_true_sorted == 1)) / n_pos)
    return max(0.0, min(1.0, ap))


def compute_roc_auc(y_true: np.ndarray, y_prob: np.ndarray) -> float:
    """Compute ROC-AUC from continuous probabilities via trapezoidal integration."""
    y_true_flat = y_true.flatten().astype(int)
    y_prob_flat = y_prob.flatten().astype(float)

    n_pos = np.sum(y_true_flat == 1)
    n_neg = np.sum(y_true_flat == 0)

    if n_pos == 0 or n_neg == 0:
        return 0.5

    order = np.argsort(-y_prob_flat)
    y_true_sorted = y_true_flat[order]

    tp_cumulative = np.cumsum(y_true_sorted == 1)
    fp_cumulative = np.cumsum(y_true_sorted == 0)

    tpr = tp_cumulative / n_pos
    fpr = fp_cumulative / n_neg

    tpr = np.insert(tpr, 0, 0.0)
    fpr = np.insert(fpr, 0, 0.0)

    auc = float(0.5 * np.sum((tpr[1:] + tpr[:-1]) * np.diff(fpr)))
    return max(0.0, min(1.0, auc))


def calculate_candidate_cohort_metrics(
    y_true: np.ndarray, y_prob: np.ndarray, threshold: float
) -> Dict[str, Any]:
    """Calculate comprehensive evaluation metrics on a candidate cohort."""
    y_true_flat = y_true.flatten().astype(int)
    y_prob_flat = y_prob.flatten().astype(float)

    n_pos = int(np.sum(y_true_flat == 1))
    n_neg = int(np.sum(y_true_flat == 0))

    if n_pos == 0 or n_neg == 0:
        return {
            "status": "INSUFFICIENT_CLASS_COVERAGE",
            "row_count": len(y_true_flat),
            "positive_count": n_pos,
            "negative_count": n_neg,
        }

    pr_auc = compute_average_precision(y_true_flat, y_prob_flat)
    roc_auc = compute_roc_auc(y_true_flat, y_prob_flat)

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

    return {
        "status": "OK",
        "row_count": len(y_true_flat),
        "positive_count": n_pos,
        "negative_count": n_neg,
        "pr_auc": pr_auc,
        "roc_auc": roc_auc,
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "confusion_matrix": [[tn, fp], [fn, tp]],
    }


def select_anomaly_validation_threshold(val_scores: np.ndarray) -> float:
    """Select decision threshold strictly on VALIDATION reconstruction scores."""
    if len(val_scores) == 0:
        raise ValueError(
            "NO_VALIDATION_SCORES: Cannot compute threshold on empty validation scores"
        )

    threshold = float(np.quantile(val_scores, 0.99, method="linear"))
    return threshold


def apply_synthetic_standardized_shift(
    X_std: np.ndarray, source_product_ids: List[str]
) -> np.ndarray:
    """Apply deterministic +6 sigma standardized shift per anomaly-synthetic-standardized-shift-v1."""
    X_synthetic = X_std.copy()
    input_dim = X_std.shape[1]

    for i, pid in enumerate(source_product_ids):
        digest = hashlib.sha256(str(pid).encode("utf-8")).hexdigest()
        feature_idx = int(digest[:16], 16) % input_dim
        X_synthetic[i, feature_idx] += 6.0

    return X_synthetic


def calculate_anomaly_score_distribution(scores: np.ndarray) -> Dict[str, float]:
    """Calculate statistical distribution of continuous anomaly scores."""
    s = scores.flatten().astype(float)
    if len(s) == 0:
        return {
            "mean": 0.0,
            "median": 0.0,
            "p95": 0.0,
            "p99": 0.0,
            "max": 0.0,
        }

    return {
        "mean": float(np.mean(s)),
        "median": float(np.median(s)),
        "p95": float(np.quantile(s, 0.95, method="linear")),
        "p99": float(np.quantile(s, 0.99, method="linear")),
        "max": float(np.max(s)),
    }
