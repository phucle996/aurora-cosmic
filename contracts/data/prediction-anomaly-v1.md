# Anomaly Prediction Contract (`prediction-anomaly-v1`)

Defines the output record structure emitted by production Astronomical Anomaly Detection inference.

---

## 1. Schema Definition

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "AnomalyPredictionRecord",
  "type": "object",
  "required": [
    "schema_version",
    "prediction_id",
    "prediction_fingerprint",
    "task",
    "job_id",
    "gold_snapshot_id",
    "gold_artifact_key",
    "source_product_id",
    "tic_id",
    "sector",
    "runtime_package_id",
    "runtime_validation_id",
    "registered_model_id",
    "evaluation_run_id",
    "dataset_view_version",
    "model_input_sha256",
    "reconstruction_mse",
    "score_definition_version",
    "decision_threshold",
    "above_threshold",
    "predicted_at",
    "producer"
  ],
  "properties": {
    "schema_version": { "type": "integer", "const": 1 },
    "prediction_id": { "type": "string", "pattern": "^pred-anom-v1-[0-9a-f]{16,64}$" },
    "prediction_fingerprint": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
    "task": { "type": "string", "const": "astronomical_anomaly_detection" },
    "job_id": { "type": "string" },
    "gold_snapshot_id": { "type": "string" },
    "gold_artifact_key": { "type": "string" },
    "source_product_id": { "type": "string" },
    "tic_id": { "type": "integer" },
    "sample_id": { "type": "string" },
    "sector": { "type": "integer" },
    "runtime_package_id": { "type": "string" },
    "runtime_validation_id": { "type": "string" },
    "registered_model_id": { "type": "string" },
    "evaluation_run_id": { "type": "string" },
    "dataset_view_version": { "type": "string" },
    "model_input_sha256": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
    "reconstruction_mse": { "type": "number", "minimum": 0.0 },
    "score_definition_version": { "type": "string", "const": "reconstruction-mse-v1" },
    "decision_threshold": { "type": "number", "minimum": 0.0 },
    "above_threshold": { "type": "boolean" },
    "predicted_at": { "type": "string", "format": "date-time" },
    "producer": { "type": "string", "default": "rust-inference" }
  },
  "additionalProperties": false
}
```

---

## 2. Invariants

* **Deterministic Identity**: `prediction_id` is derived from `task`, `runtime_package_id`, `gold_snapshot_id`, and `source_product_id`.
* **Reconstruction Score**: `reconstruction_mse = (1 / D) * sum((x_i - x_hat_i)^2)` in standardized feature space.
* **Decision**: `above_threshold = (reconstruction_mse >= decision_threshold)`.
* **Scientific Guardrail**: Anomaly scores measure statistical unusualness, NOT confirmation of an extraterrestrial phenomenon.
