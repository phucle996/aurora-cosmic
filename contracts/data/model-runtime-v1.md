# Contract: `model-runtime-v1`

Defines the immutable specification and package manifest for an exported ONNX Runtime Package in AURORA.

## Storage Path

* **Candidate Runtime Package**: `models/runtime/candidate/<runtime-package-id>/manifest.json`
  * Sibling files: `model.onnx`, `preprocessing.json`, `threshold.json`, `parity-fixture.json`
* **Anomaly Runtime Package**: `models/runtime/anomaly/<runtime-package-id>/manifest.json`
  * Sibling files: `model.onnx`, `preprocessing.json`, `threshold.json`, `parity-fixture.json`
* **Format**: JSON (UTF-8, deterministic field sorting)
* **Status**: Immutable once committed. `manifest.json` is written last as the package commit marker.

## Schema Definition

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "ModelRuntimeManifest",
  "type": "object",
  "required": [
    "schema_version",
    "runtime_package_id",
    "runtime_fingerprint",
    "task",
    "source_model_id",
    "source_model_manifest_sha256",
    "source_evaluation_run_id",
    "source_evaluation_manifest_sha256",
    "model_version",
    "preprocessing_version",
    "preprocessing_sha256",
    "threshold_policy_version",
    "threshold_sha256",
    "decision_threshold",
    "score_definition_version",
    "feature_order",
    "onnx_export_version",
    "onnx_opset",
    "onnx_input_name",
    "onnx_input_shape",
    "onnx_output_name",
    "onnx_output_shape",
    "onnx_sha256",
    "onnx_size_bytes",
    "parity_fixture_version",
    "parity_fixture_sha256",
    "python_parity_policy_version",
    "python_parity_status",
    "created_at",
    "producer"
  ],
  "properties": {
    "schema_version": { "type": "integer", "const": 1 },
    "runtime_package_id": { "type": "string", "pattern": "^runtime-v1-[a-f0-9]{12,16}$" },
    "runtime_fingerprint": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
    "task": {
      "type": "string",
      "enum": ["candidate_vetting", "astronomical_anomaly_detection"]
    },
    "source_model_id": { "type": "string" },
    "source_model_manifest_sha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
    "source_evaluation_run_id": { "type": "string" },
    "source_evaluation_manifest_sha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
    "model_version": { "type": "string" },
    "preprocessing_version": { "type": "string" },
    "preprocessing_sha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
    "threshold_policy_version": { "type": "string" },
    "threshold_sha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
    "decision_threshold": { "type": "number" },
    "score_definition_version": { "type": "string" },
    "feature_order": {
      "type": "array",
      "items": { "type": "string" }
    },
    "onnx_export_version": { "type": "string", "const": "onnx-export-v1" },
    "onnx_opset": { "type": "integer", "const": 17 },
    "onnx_input_name": { "type": "string", "const": "features" },
    "onnx_input_shape": { "type": "array", "items": { "type": ["integer", "null"] } },
    "onnx_output_name": { "type": "string" },
    "onnx_output_shape": { "type": "array", "items": { "type": ["integer", "null"] } },
    "onnx_sha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
    "onnx_size_bytes": { "type": "integer", "minimum": 1 },
    "parity_fixture_version": { "type": "string", "const": "runtime-parity-fixture-v1" },
    "parity_fixture_sha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
    "python_parity_policy_version": { "type": "string", "const": "python-native-onnx-parity-v1" },
    "python_parity_status": { "type": "string", "const": "PASS" },
    "created_at": { "type": "string", "format": "date-time" },
    "producer": { "type": "string", "const": "python-ml-worker" }
  },
  "additionalProperties": false
}
```
