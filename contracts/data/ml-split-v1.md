# ml-split-v1 — AURORA Deterministic Group Split Contract & Manifest

## Purpose

Defines the contract for group-safe, deterministic dataset splits (`candidate-group-split-v1`) and immutable split manifests stored at `manifests/ml-splits/<split-id>.json`.

## Split Policy Version

`split_policy_version: "candidate-group-split-v1"`

## Group Identity Rule

All rows belonging to the same astronomical target MUST belong to the exact same split (Train or Validation). Multi-sector observations for the same TIC ID MUST NEVER be split across sets.

Group Key Definition:
```text
group_key = "tic:<tic_id>"            (when tic_id is available)
group_key = "source:<source_product_id>"  (fallback when tic_id is missing)
```

## Deterministic Hash Assignment Algorithm

Each target group is deterministically mapped to a split bucket via SHA-256 digest:
```text
digest = SHA256(split_policy_version + ":" + split_seed + ":" + group_key)
bucket = uint32_from_be_bytes(digest[:4]) % 10000
```

Bucket Mapping:
- `0 .. 7999` (80%) -> `TRAIN`
- `8000 .. 9999` (20%) -> `VALIDATION`

## Split Manifest Layout

Split manifests are stored immutably at `manifests/ml-splits/<split-id>.json`:

```json
{
  "schema_version": 1,
  "split_id": "split-v1-a3f2c8d192801481",
  "split_fingerprint": "c4ca4238a0b923820dcc509a6f75849b...",
  "gold_snapshot_id": "gold-v1-20260808-120000",
  "gold_manifest_sha256": "8f3a5b...",
  "dataset_view_version": "candidate-ml-view-v1",
  "split_policy_version": "candidate-group-split-v1",
  "split_seed": 42,
  "eligible_row_count": 1000,
  "eligible_group_count": 800,
  "train_group_count": 640,
  "validation_group_count": 160,
  "train_row_count": 800,
  "validation_row_count": 200,
  "feature_names": [ ... ],
  "assignments": [
    { "group_key": "tic:12345678", "split": "TRAIN", "row_count": 2 },
    { "group_key": "tic:87654321", "split": "VALIDATION", "row_count": 1 }
  ],
  "created_at": "2026-08-08T12:00:00Z"
}
```

## Immutability Guarantee

Once written to `manifests/ml-splits/<split-id>.json`, a split manifest MUST NEVER be modified or overwritten. Re-running the split with identical inputs reuses the existing manifest. Incompatible content under an existing `split_id` raises `ML_SPLIT_CONFLICT`.
