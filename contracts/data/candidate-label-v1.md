# candidate-label-v1 — AURORA Versioned Candidate Label Contract

## Purpose

Durable schema contract for candidate training label snapshots derived from matched TOI/TCE catalog state under `candidate-label-policy-v1`.

## Schema Version

`label_policy_version: "candidate-label-policy-v1"`

## Primary Key

`(source_product_id, lc_feature_version)`

## Column Schema

| Column Name | Arrow Type | Nullable | Description |
| :--- | :--- | :---: | :--- |
| `source_product_id` | `Utf8` | No | Original NASA/MAST source product identifier. |
| `sample_id` | `Utf8` | Yes | TIC/sector sample identifier. |
| `tic_id` | `Int64` | Yes | TESS Input Catalog ID. |
| `matched_toi_id` | `Utf8` | Yes | Matched TOI ID (null if no match or unresolved). |
| `toi_match_status` | `Utf8` | No | Status: `"EPHEMERIS_MATCH"`, `"PERIOD_ONLY"`, `"NO_MATCH"`, `"AMBIGUOUS"`. |
| `matched_tce_id` | `Utf8` | Yes | Matched TCE ID (null if no match or unresolved). |
| `tce_match_status` | `Utf8` | No | Status: `"EPHEMERIS_MATCH"`, `"PERIOD_ONLY"`, `"NO_MATCH"`, `"AMBIGUOUS"`. |
| `training_label` | `Utf8` | No | Conservative label: `"POSITIVE"`, `"NEGATIVE"`, `"UNRESOLVED"`, `"EXCLUDED"`. |
| `label_policy_version` | `Utf8` | No | Label derivation policy version (`"candidate-label-policy-v1"`). |
| `toi_snapshot_id` | `Utf8` | Yes | SHA-256 ID of the exact TOI catalog snapshot used. |
| `tce_snapshot_id` | `Utf8` | Yes | SHA-256 ID of the exact TCE catalog snapshot used. |

## Label Mapping Rules (`candidate-label-policy-v1`)

1. Upstream `KNOWN_PLANET` / `CONFIRMED` -> `POSITIVE`.
2. Upstream `FALSE_POSITIVE` -> `NEGATIVE`.
3. Upstream `CANDIDATE` / `PENDING` -> `UNRESOLVED`.
4. No catalog match or `AMBIGUOUS` match -> `UNRESOLVED`.
5. *Unmatched targets or pending TOI candidates are NEVER automatically labeled as POSITIVE or NEGATIVE.*
