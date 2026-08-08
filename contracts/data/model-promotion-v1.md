# Contract: `model-promotion-v1`

Defines the immutable audit log record for champion promotion and rollback actions in AURORA.

## Storage Path

* **Promotions Path**: `models/<task>/promotions/<promotion-id>.json`
  * Example: `models/candidate/promotions/promo-cand-v1-a1b2c3d4e5f6.json`
  * Example: `models/anomaly/promotions/promo-anom-v1-1234567890ab.json`
* **Champion Pointer**: `models/<task>/champion.json` (Atomic JSON pointer to current active champion model)
* **Format**: JSON (UTF-8, deterministic field sorting)
* **Status**: Immutable once written

## Schema Definition

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "ModelPromotionRecord",
  "type": "object",
  "required": [
    "schema_version",
    "promotion_id",
    "promotion_fingerprint",
    "task",
    "action",
    "policy_version",
    "champion_model_id",
    "comparison_decision",
    "created_at",
    "producer"
  ],
  "properties": {
    "schema_version": { "type": "integer", "const": 1 },
    "promotion_id": { "type": "string", "pattern": "^promo-(cand|anom)-v1-[a-f0-9]{12,16}$" },
    "promotion_fingerprint": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
    "task": {
      "type": "string",
      "enum": ["candidate_vetting", "astronomical_anomaly_detection"]
    },
    "action": {
      "type": "string",
      "enum": ["PROMOTE", "ROLLBACK"]
    },
    "policy_version": {
      "type": "string",
      "enum": [
        "candidate-promote-pr-auc-v1",
        "anomaly-promote-synthetic-v1",
        "candidate-rollback-v1",
        "anomaly-rollback-v1"
      ]
    },
    "champion_model_id": { "type": "string" },
    "previous_champion_model_id": { "type": ["string", "null"] },
    "evaluation_run_id": { "type": ["string", "null"] },
    "evaluation_metrics_summary": { "type": ["object", "null"] },
    "comparison_decision": {
      "type": "string",
      "enum": [
        "BOOTSTRAP_INITIAL_CHAMPION",
        "CHALLENGER_OUTPERFORMS_CHAMPION",
        "ROLLBACK_RESTORE_CHAMPION"
      ]
    },
    "created_at": { "type": "string", "format": "date-time" },
    "producer": { "type": "string", "const": "python-ml-worker" }
  },
  "additionalProperties": false
}
```

## Champion Pointer (`champion.json`)

Stored dynamically at `models/<task>/champion.json`:
```json
{
  "model_id": "model-cand-v1-a1b2c3d4e5f6",
  "promotion_id": "promo-cand-v1-9876543210ab",
  "promoted_at": "2026-08-08T00:00:00Z"
}
```
