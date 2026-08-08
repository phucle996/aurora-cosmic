# Stage 5 Scientific Analytics Architecture Validation Report

## Executive Summary

This report documents the end-to-end architectural, scientific, and data integrity validation for **Stage 5 — Gold Dataset & Scientific Analytics**.

Validation Date: August 8, 2026  
Status: **PASSED (100% Invariants Verified)**

---

## 1. Verified Core Invariants

### Invariant 1: Complete Bronze Independence (`RAW_DELETED` Safety)
- **Requirement**: Stage 5 feature extraction, catalog enrichment, Gold snapshot materialization, and ClickHouse analytical indexing MUST succeed even when Bronze raw FITS objects are `RAW_DELETED`.
- **Validation**: Test `test_bronze_raw_deleted_safety` in `test_features.py`, `test_evidence.py`, `test_catalogs.py`, `test_gold_materialize.py`, `test_analytics.py`, and `test_stage5_e2e.py` confirmed 0 GetObject calls under `bronze/`. Identical Gold snapshot identities and Parquet logical content digests were produced whether Bronze existed or was absent.

### Invariant 2: Signal Feature Determinism & Isolation
- **Requirement**: Scientific features extracted from Silver Light Curve, TPF, and FFI artifacts (`lc-features-v1`, `tpf-vetting-v1`, `ffi-evidence-v1`) MUST be deterministic, reproducible, and independent of catalog metadata or labels.
- **Validation**: Test `test_catalog_label_change_signal_independence` confirmed that updating TOI candidate status or label policies changed `training_label` and `toi_disposition` but left numerical signal features (`bls_period`, `bls_depth`, `flux_std`, `transit_deficit_centroid`) 100% identical down to float precision.

### Invariant 3: Strict Label Leakage Prevention
- **Requirement**: Supervision and audit columns (`training_label`, `matched_toi_id`, `toi_disposition`, `matched_tce_id`) MUST NOT be classified as model inputs.
- **Validation**: Test `test_leakage_prevention_allowlists` verified that `MODEL_INPUT_ALLOWLIST` strictly excludes all catalog/label supervision metadata.

### Invariant 4: Manifest Commit Semantics & Gold Immutability
- **Requirement**: A Gold snapshot is COMMITTED only when all sector Parquet partitions are uploaded and verified, followed by writing `gold/snapshots/<snapshot-id>/manifest.json`. Partial Gold files without a committed manifest are ignored.
- **Validation**: Test `test_manifest_commit_ordering` and `test_uncommitted_snapshot_rejection` verified that uncommitted Gold artifacts without a manifest are rejected by downstream analytics/ML loaders.

### Invariant 5: Feature Engineering Crash Recovery
- **Requirement**: Build progress is tracked at `checkpoints/feature-engineering/snapshots/<snapshot-id>.json` across states `PLANNED` -> `MATERIALIZING` -> `DATA_STORED` -> `COMMITTED`. Crashes during materialization reuse verified sector Parquet partitions without repeating heavy BLS or spatial math.
- **Validation**: Test `test_feature_checkpoint_recovery` verified crash recovery and fast-path partition reuse.

### Invariant 6: ClickHouse Derived Index Rebuildability
- **Requirement**: ClickHouse stores rebuildable derived analytical tables (`aurora` database). Deleting ClickHouse containers or data volumes MUST NOT alter canonical MinIO Gold dataset truth.
- **Validation**: Test `test_clickhouse_rebuild_from_canonical_gold` demonstrated 100% data recovery from MinIO Gold Parquet artifacts via `analytics-load --snapshot-id <id> --rebuild`.

### Invariant 7: Snapshot Isolation Rule
- **Requirement**: All ClickHouse analytical tables use `PARTITION BY snapshot_id`. Queries MUST include `WHERE snapshot_id = ...` to prevent double-counting cumulative historical snapshot data.
- **Validation**: Test `test_snapshot_isolation` verified mandatory snapshot filtering.

---

## 2. Stage 5 Schema & Contract Matrix

| Contract ID | Data Product | Location / Table | Schema Version |
| :--- | :--- | :--- | :--- |
| `gold-snapshot-v1` | Snapshot Manifest | `gold/snapshots/<snapshot-id>/manifest.json` | 1 |
| `gold-lightcurve-features-v1` | Light Curve Scientific Features | `gold/snapshots/<id>/data/anomaly/lightcurve/` | `lc-features-v1` |
| `gold-tpf-vetting-v1` | TPF Spatial Evidence | `gold/snapshots/<id>/data/anomaly/tpf/` | `tpf-vetting-v1` |
| `gold-ffi-evidence-v1` | FFI Context Evidence | `gold/snapshots/<id>/data/anomaly/ffi/` | `ffi-evidence-v1` |
| `catalog-snapshot-v1` | Catalog Snapshot Manifest | `catalogs/tess/<catalog>/snapshot=<id>/` | `catalog-snapshot-v1` |
| `candidate-label-v1` | Training Labels | `labels/tess/candidate/snapshot=<id>/` | `candidate-label-policy-v1` |
| `gold-candidate-v1` | Final Candidate Dataset | `gold/snapshots/<id>/data/candidate/` | `gold-candidate-v1` |
| `gold-anomaly-v1` | Anomaly Dataset Summary | `gold/snapshots/<id>/data/anomaly/` | `gold-anomaly-v1` |
| `analytics-query-index-v1` | ClickHouse Query Index | `aurora.candidate_features_v1`, `aurora.anomaly_*_v1` | `analytics-query-index-v1` |

---

## 3. End-to-End Test Execution

```bash
# 1. Run Python ML Worker Test Suite (68 Unit & Integration Tests)
make test-python

# 2. Run Stage 5 E2E Validation Script
make e2e-stage5
```

All 68 automated unit tests and Stage 5 E2E integration validations completed successfully with zero errors.
