# Candidate Prediction Contract (`prediction-candidate-v1`)

Defines the output record structure emitted by production Candidate Vetting inference.

---

## 1. Schema Definition

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "CandidatePredictionRecord",
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
    "raw_logit",
    "candidate_score",
    "score_definition_version",
    "decision_threshold",
    "above_threshold",
    "predicted_at",
    "producer"
  ],
  "properties": {
    "schema_version": { "type": "integer", "const": 1 },
    "prediction_id": { "type": "string", "pattern": "^pred-cand-v1-[0-9a-f]{16,64}$" },
    "prediction_fingerprint": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
    "task": { "type": "string", "const": "candidate_vetting" },
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
    "raw_logit": { "type": "number" },
    "candidate_score": { "type": "number", "minimum": 0.0, "maximum": 1.0 },
    "score_definition_version": { "type": "string", "const": "candidate-sigmoid-score-v1" },
    "decision_threshold": { "type": "number", "minimum": 0.0, "maximum": 1.0 },
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
* **Model-Input Hashing**: `model_input_sha256` is computed by SHA-256 over the little-endian bytes of the standardized `float32` input tensor.
* **Score & Decision Consistency**: `candidate_score = 1.0 / (1.0 + exp(-raw_logit))` and `above_threshold = (candidate_score >= decision_threshold)`.
* **Scientific Truth**: Candidate predictions represent vetting scores, NOT scientific confirmation (`is_planet` or `confirmed_planet` are forbidden).
