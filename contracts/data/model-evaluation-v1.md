# Contract: `model-evaluation-v1`

Defines the immutable specification and results of an evaluation run for a trained machine learning model against frozen Golden Test and Recent Holdout cohorts.

## Format & Path

* **Storage Path**: `evaluations/runs/<task>/<evaluation-run-id>/manifest.json`
  * Example: `evaluations/runs/candidate/eval-cand-v1-a1b2c3d4e5f6/manifest.json`
  * Example: `evaluations/runs/anomaly/eval-anom-v1-1234567890ab/manifest.json`
* **Sibling Artifacts**:
  * `evaluations/runs/<task>/<evaluation-run-id>/threshold.json`
  * `evaluations/runs/<task>/<evaluation-run-id>/metrics.json`
* **Format**: JSON (UTF-8, deterministic field sorting)
* **Status**: Immutable once committed

## Schema Definition

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "ModelEvaluationRunManifest",
  "type": "object",
  "required": [
    "schema_version",
    "evaluation_run_id",
    "evaluation_spec_fingerprint",
    "task",
    "training_run_id",
    "training_run_manifest_sha256",
    "model_version",
    "model_sha256",
    "preprocessing_version",
    "preprocessing_sha256",
    "golden_cohort_id",
    "golden_cohort_manifest_sha256",
    "evaluation_policy_version",
    "threshold_policy_version",
    "decision_threshold",
    "threshold_sha256",
    "metrics_sha256",
    "metrics",
    "created_at",
    "producer"
  ],
  "properties": {
    "schema_version": { "type": "integer", "const": 1 },
    "evaluation_run_id": { "type": "string", "pattern": "^eval-(cand|anom)-v1-[a-f0-9]{12,16}$" },
    "evaluation_spec_fingerprint": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
    "task": {
      "type": "string",
      "enum": ["candidate_vetting", "astronomical_anomaly_detection"]
    },
    "training_run_id": { "type": "string" },
    "training_run_manifest_sha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
    "model_version": { "type": "string" },
    "model_sha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
    "preprocessing_version": { "type": "string" },
    "preprocessing_sha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
    "golden_cohort_id": { "type": "string" },
    "golden_cohort_manifest_sha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
    "recent_cohort_id": { "type": ["string", "null"] },
    "recent_cohort_manifest_sha256": { "type": ["string", "null"] },
    "evaluation_policy_version": {
      "type": "string",
      "enum": ["candidate-evaluation-v1", "anomaly-evaluation-v1"]
    },
    "threshold_policy_version": {
      "type": "string",
      "enum": ["candidate-threshold-max-f1-v1", "anomaly-threshold-validation-p99-v1"]
    },
    "decision_threshold": { "type": "number" },
    "threshold_sha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
    "metrics_sha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
    "metrics": { "type": "object" },
    "created_at": { "type": "string", "format": "date-time" },
    "producer": { "type": "string", "const": "python-ml-worker" }
  },
  "additionalProperties": false
}
```

## Sibling Artifact Contracts

### 1. `threshold.json`
Stores the exact decision threshold selected strictly from the **VALIDATION** set.
* For Candidate: `threshold_policy_version = "candidate-threshold-max-f1-v1"`, `selection_source = "VALIDATION"`, validation precision, recall, F1.
* For Anomaly: `threshold_policy_version = "anomaly-threshold-validation-p99-v1"`, `quantile = 0.99`, `quantile_method = "linear"`, `selection_source = "VALIDATION"`.

### 2. `metrics.json`
Stores detailed evaluation metrics:
* For Candidate:
  * `golden_pr_auc` (Average Precision), `golden_roc_auc`, `golden_precision`, `golden_recall`, `golden_f1`, `golden_confusion_matrix` (`[[TN, FP], [FN, TP]]`).
  * `recent_pr_auc`, `recent_roc_auc`, `recent_precision`, `recent_recall`, `recent_f1`, `recent_status` (or `"INSUFFICIENT_CLASS_COVERAGE"` if single class).
  * `pr_auc_drift`, `recall_drift`.
* For Anomaly:
  * `golden_reference_alert_rate`, `golden_score_mean`, `golden_score_median`, `golden_score_p95`, `golden_score_p99`, `golden_score_max`.
  * `golden_synthetic_detection_rate`, `golden_synthetic_score_mean`, `golden_synthetic_score_median`, `golden_synthetic_score_p95`, `synthetic_score_separation`.
  * `recent_reference_alert_rate`, `recent_synthetic_detection_rate`, `recent_score_mean`, `recent_score_median`, `alert_rate_drift`.
