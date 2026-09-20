"""Threshold Selection & Metric Calculations (Post-training Stage 3)."""

from __future__ import annotations

from typing import Any, Dict, Tuple
import numpy as np


def select_candidate_validation_threshold(
    y_true: np.ndarray, y_prob: np.ndarray
) -> Tuple[float, float, float, float]:
    """Select decision threshold strictly on VALIDATION set using candidate-threshold-max-f1-v1."""
    y_true_flat = y_true.flatten().astype(int)
    y_prob_flat = y_prob.flatten().astype(float)

    if len(y_prob_flat) == 0:
        return 0.5, 0.0, 0.0, 0.0

    # Sort probabilities ascending to allow prefix sum calculations
    order = np.argsort(y_prob_flat)
    sorted_prob = y_prob_flat[order]
    sorted_true = y_true_flat[order]

    unique_probs = np.unique(sorted_prob)
    candidate_thresholds = np.sort(unique_probs)

    n_total = len(sorted_true)
    n_pos = int(np.sum(sorted_true))

    # Binary search to find start indices where sorted_prob >= threshold in O(K log N)
    split_indices = np.searchsorted(sorted_prob, candidate_thresholds, side="left")

    # Cumulative sum of true labels to query counts in range [split_indices, n_total) in O(1)
    cum_true = np.zeros(n_total + 1, dtype=np.int64)
    np.cumsum(sorted_true, out=cum_true[1:])

    tps = cum_true[-1] - cum_true[split_indices]
    fps = (n_total - split_indices) - tps
    fns = n_pos - tps

    # Compute prec, rec, f1 vectorized across all candidate thresholds cleanly without zero-division warnings
    pred_pos = tps + fps
    actual_pos = tps + fns

    precs = np.divide(
        tps.astype(float),
        pred_pos.astype(float),
        out=np.zeros(len(tps), dtype=float),
        where=pred_pos > 0,
    )
    recs = np.divide(
        tps.astype(float),
        actual_pos.astype(float),
        out=np.zeros(len(tps), dtype=float),
        where=actual_pos > 0,
    )
    prec_plus_rec = precs + recs
    f1s = np.divide(
        2.0 * precs * recs,
        prec_plus_rec,
        out=np.zeros(len(tps), dtype=float),
        where=prec_plus_rec > 0,
    )

    best_thresh = 0.5
    best_f1 = -1.0
    best_rec = -1.0
    best_prec = -1.0

    # Fast scalar tie-breaking loop over pre-calculated metrics (no array allocation)
    for i in range(len(candidate_thresholds)):
        t = float(candidate_thresholds[i])
        f1 = float(f1s[i])
        rec = float(recs[i])
        prec = float(precs[i])

        if f1 > best_f1:
            best_f1, best_rec, best_prec, best_thresh = f1, rec, prec, t
        elif abs(f1 - best_f1) < 1e-9:
            if rec > best_rec:
                best_f1, best_rec, best_prec, best_thresh = f1, rec, prec, t
            elif abs(rec - best_rec) < 1e-9:
                if prec > best_prec:
                    best_f1, best_rec, best_prec, best_thresh = f1, rec, prec, t
                elif abs(prec - best_prec) < 1e-9:
                    if t < best_thresh:
                        best_f1, best_rec, best_prec, best_thresh = f1, rec, prec, t

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
