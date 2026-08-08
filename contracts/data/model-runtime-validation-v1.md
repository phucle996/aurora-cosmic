# Contract: `model-runtime-validation-v1`

Defines the immutable audit log record for cross-language runtime numerical parity validation between Python native PyTorch, Python ONNX Runtime, and Rust ONNX Runtime.

## Storage Path

* **Format**: JSON (UTF-8, deterministic field sorting)
* **Status**: Immutable once written.

## Schema Definition

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "ModelRuntimeValidationRecord",
  "type": "object",
  "required": [
    "schema_version",
    "validation_record_id",
    "runtime_package_id",
    "runtime_manifest_sha256",
    "engine",
    "parity_fixture_sha256",
    "max_absolute_error",
    "max_relative_error",
    "atol_limit",
    "rtol_limit",
    "validation_status",
    "created_at",
    "producer"
  ],
  "properties": {
    "schema_version": { "type": "integer", "const": 1 },
    "validation_record_id": { "type": "string", "pattern": "^rval-v1-[a-f0-9]{12,16}$" },
    "runtime_package_id": { "type": "string" },
    "runtime_manifest_sha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
    "engine": {
      "type": "string",
      "enum": ["python-onnxruntime", "rust-inference-ort"]
    },
    "parity_fixture_sha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
    "max_absolute_error": { "type": "number" },
    "max_relative_error": { "type": "number" },
    "atol_limit": { "type": "number", "const": 1e-5 },
    "rtol_limit": { "type": "number", "const": 1e-5 },
    "validation_status": {
      "type": "string",
      "enum": ["PASS", "FAIL"]
    },
    "created_at": { "type": "string", "format": "date-time" },
    "producer": { "type": "string" }
  },
  "additionalProperties": false
}
```
