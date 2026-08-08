# Inference Job Contract (`inference-job-v1`)

Defines the immutable work specification for executing production model inference on a committed Gold partition artifact.

---

## 1. Schema Definition

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "InferenceJobManifest",
  "type": "object",
  "required": [
    "schema_version",
    "job_id",
    "job_fingerprint",
    "task",
    "selection_policy_version",
    "gold_snapshot_id",
    "gold_manifest_key",
    "gold_manifest_sha256",
    "gold_dataset",
    "gold_schema_version",
    "gold_artifact_key",
    "gold_artifact_content_sha256",
    "gold_artifact_row_count",
    "sector",
    "runtime_package_id",
    "runtime_manifest_key",
    "runtime_manifest_sha256",
    "runtime_validation_id",
    "model_id",
    "model_version",
    "evaluation_run_id",
    "dataset_view_version",
    "dataset_view_fingerprint",
    "feature_names",
    "expected_prediction_count",
    "created_at",
    "producer"
  ],
  "properties": {
    "schema_version": { "type": "integer", "const": 1 },
    "job_id": { "type": "string", "pattern": "^inference-job-v1-[0-9a-f]{16,64}$" },
    "job_fingerprint": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
    "task": { "type": "string", "enum": ["candidate_vetting", "astronomical_anomaly_detection"] },
    "selection_policy_version": {
      "type": "string",
      "enum": ["candidate-inference-selection-v1", "anomaly-lightcurve-inference-selection-v1"]
    },
    "gold_snapshot_id": { "type": "string" },
    "gold_manifest_key": { "type": "string" },
    "gold_manifest_sha256": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
    "gold_dataset": { "type": "string" },
    "gold_schema_version": { "type": "string" },
    "gold_artifact_key": { "type": "string" },
    "gold_artifact_content_sha256": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
    "gold_artifact_parquet_sha256": { "type": "string" },
    "gold_artifact_size_bytes": { "type": "integer" },
    "gold_artifact_row_count": { "type": "integer", "minimum": 1 },
    "sector": { "type": "integer", "minimum": 1 },
    "runtime_package_id": { "type": "string" },
    "runtime_manifest_key": { "type": "string" },
    "runtime_manifest_sha256": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
    "runtime_validation_id": { "type": "string" },
    "runtime_validation_key": { "type": "string" },
    "runtime_validation_sha256": { "type": "string" },
    "model_id": { "type": "string" },
    "model_version": { "type": "string" },
    "evaluation_run_id": { "type": "string" },
    "dataset_view_version": { "type": "string" },
    "dataset_view_fingerprint": { "type": "string" },
    "feature_names": { "type": "array", "items": { "type": "string" } },
    "expected_prediction_count": { "type": "integer", "minimum": 1 },
    "created_at": { "type": "string", "format": "date-time" },
    "producer": { "type": "string", "default": "python-ml-worker" }
  },
  "additionalProperties": false
}
```

---

## 2. Invariants & Storage

1. **Storage Path**: `manifests/inference-jobs/<task>/<job-id>.json`.
2. **Work Granularity**: Exactly one inference job per committed Gold Parquet artifact.
3. **Immutability**: A job manifest is intent, not progress; it is strictly immutable once committed.
4. **Runtime Pinning**: Jobs pin an exact `runtime_package_id` and never mutate if a champion pointer changes.
