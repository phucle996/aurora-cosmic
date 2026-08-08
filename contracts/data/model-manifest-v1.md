# Contract: `model-manifest-v1`

Defines the immutable specification and package manifest for a registered machine learning model package in AURORA.

## Storage Path

* **Candidate Model**: `models/candidate/<model-id>/manifest.json`
  * Sibling files: `models/candidate/<model-id>/model.pt`, `models/candidate/<model-id>/preprocessing.json`
* **Anomaly Model**: `models/anomaly/<model-id>/manifest.json`
  * Sibling files: `models/anomaly/<model-id>/model.pt`, `models/anomaly/<model-id>/preprocessing.json`
* **Format**: JSON (UTF-8, deterministic field sorting)
* **Status**: Immutable once committed. `manifest.json` is written last as the package commit marker.

## Schema Definition

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "ModelPackageManifest",
  "type": "object",
  "required": [
    "schema_version",
    "model_id",
    "model_fingerprint",
    "task",
    "model_version",
    "preprocessing_version",
    "training_run_id",
    "training_run_manifest_sha256",
    "evaluation_run_id",
    "evaluation_run_manifest_sha256",
    "gold_snapshot_id",
    "gold_manifest_sha256",
    "split_id",
    "dataset_view_version",
    "dataset_view_fingerprint",
    "feature_order",
    "model_pt_sha256",
    "preprocessing_json_sha256",
    "created_at",
    "producer"
  ],
  "properties": {
    "schema_version": { "type": "integer", "const": 1 },
    "model_id": { "type": "string", "pattern": "^model-(cand|anom)-v1-[a-f0-9]{12,16}$" },
    "model_fingerprint": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
    "task": {
      "type": "string",
      "enum": ["candidate_vetting", "astronomical_anomaly_detection"]
    },
    "model_version": { "type": "string" },
    "preprocessing_version": { "type": "string" },
    "training_run_id": { "type": "string" },
    "training_run_manifest_sha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
    "evaluation_run_id": { "type": "string" },
    "evaluation_run_manifest_sha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
    "gold_snapshot_id": { "type": "string" },
    "gold_manifest_sha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
    "split_id": { "type": "string" },
    "dataset_view_version": { "type": "string" },
    "dataset_view_fingerprint": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
    "feature_order": {
      "type": "array",
      "items": { "type": "string" }
    },
    "model_pt_sha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
    "preprocessing_json_sha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
    "created_at": { "type": "string", "format": "date-time" },
    "producer": { "type": "string", "const": "python-ml-worker" }
  },
  "additionalProperties": false
}
```

## Fingerprinting Rule

```text
model_fingerprint = SHA256(canonical_json({
    dataset_view_fingerprint,
    dataset_view_version,
    evaluation_run_manifest_sha256,
    evaluation_run_id,
    feature_order: list(feature_order),
    gold_manifest_sha256,
    gold_snapshot_id,
    model_pt_sha256,
    model_version,
    preprocessing_json_sha256,
    preprocessing_version,
    split_id,
    task,
    training_run_manifest_sha256,
    training_run_id
}))
```
