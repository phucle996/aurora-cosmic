# Contract: `ml-evaluation-cohort-v1`

Defines the immutable specification and group membership of a machine learning evaluation cohort (Golden Test or Recent Holdout) for Candidate Vetting or Astronomical Anomaly Detection.

## Format & Path

* **Storage Path**: `evaluations/cohorts/<task>/<kind>/<cohort-id>/manifest.json`
  * Example: `evaluations/cohorts/candidate/golden/cohort-cand-gold-v1-a1b2c3d4/manifest.json`
  * Example: `evaluations/cohorts/anomaly/recent/cohort-anom-rec-v1-e5f6g7h8/manifest.json`
* **Format**: JSON (UTF-8, deterministic field sorting)
* **Status**: Immutable once committed

## Schema Definition

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "MLEvaluationCohortManifest",
  "type": "object",
  "required": [
    "schema_version",
    "cohort_id",
    "cohort_fingerprint",
    "task",
    "cohort_kind",
    "source_gold_snapshot_id",
    "source_gold_manifest_sha256",
    "dataset_view_version",
    "dataset_view_fingerprint",
    "selection_policy_version",
    "excluded_group_cohort_ids",
    "group_count",
    "row_count",
    "group_keys",
    "created_at",
    "producer"
  ],
  "properties": {
    "schema_version": { "type": "integer", "const": 1 },
    "cohort_id": { "type": "string", "pattern": "^cohort-(cand|anom)-(gold|rec)-v1-[a-f0-9]{12,16}$" },
    "cohort_fingerprint": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
    "task": {
      "type": "string",
      "enum": ["candidate_vetting", "astronomical_anomaly_detection"]
    },
    "cohort_kind": {
      "type": "string",
      "enum": ["GOLDEN_TEST", "RECENT_HOLDOUT"]
    },
    "source_gold_snapshot_id": { "type": "string" },
    "source_gold_manifest_sha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
    "dataset_view_version": { "type": "string" },
    "dataset_view_fingerprint": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
    "selection_policy_version": {
      "type": "string",
      "enum": [
        "candidate-golden-unseen-v1",
        "candidate-recent-sector-v1",
        "anomaly-golden-unseen-v1",
        "anomaly-recent-sector-v1"
      ]
    },
    "excluded_group_cohort_ids": {
      "type": "array",
      "items": { "type": "string" }
    },
    "group_count": { "type": "integer", "minimum": 1 },
    "row_count": { "type": "integer", "minimum": 1 },
    "positive_count": { "type": "integer", "minimum": 0 },
    "negative_count": { "type": "integer", "minimum": 0 },
    "training_max_sector": { "type": "integer", "minimum": 1 },
    "group_keys": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Deterministic sorted list of astronomical target group keys (e.g. tic:<id>)"
    },
    "created_at": { "type": "string", "format": "date-time" },
    "producer": { "type": "string", "const": "python-ml-worker" }
  },
  "additionalProperties": false
}
```

## Fingerprinting Rule

```text
cohort_fingerprint = SHA256(canonical_json({
    cohort_kind,
    dataset_view_fingerprint,
    dataset_view_version,
    excluded_group_cohort_ids: sorted(excluded_group_cohort_ids),
    group_keys: sorted(group_keys),
    selection_policy_version,
    source_gold_manifest_sha256,
    source_gold_snapshot_id,
    task
}))
```

## Key Invariants

1. **Target Group Isolation**: Golden and Recent cohorts MUST NEVER contain groups exposed to the model during TRAIN or VALIDATION.
2. **Deterministic Grouping**: Group keys follow `tic:<id>` (or `source:<product-id>` fallback) and are sorted lexicographically before hashing.
3. **Immutability**: Once written, cohort manifests are never overwritten or modified.
