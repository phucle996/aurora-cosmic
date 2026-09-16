# AURORA Scientific Analytics & Query Index Architecture (`analytics-query-index-v1`)

## Core Architectural Invariants

> **MinIO Gold Parquet + manifest.json is the CANONICAL source of truth.**
> **ClickHouse is a DERIVED, rebuildable analytical query index.**

Deleting ClickHouse data or dropping analytical tables has ZERO impact on canonical scientific dataset truth. ClickHouse can be 100% reconstructed from committed MinIO Gold snapshot Parquet artifacts at any time.

---

## 1. Derived Database Schema (`aurora`)

ClickHouse stores query projections under the `aurora` database:

### Scientific Feature & Discovery Projections
- `aurora.gold_snapshots_v1`: Derived index registry (`snapshot_id`, `manifest_sha256`, `expected_row_count`, `indexed_row_count`, `indexed_at`, `index_status`).
- `aurora.candidate_features_v1`: Analytical query table for exoplanet candidates (`gold-candidate-v1`).
- `aurora.candidate_features_current_v1`: Stable query view alias over candidate features.
- `aurora.anomaly_lightcurve_v1`: Analytical query table for light curve feature anomalies.
- `aurora.anomaly_tpf_v1`: Analytical query table for Target Pixel File spatial evidence anomalies.
- `aurora.anomaly_ffi_v1`: Analytical query table for Full Frame Image detector anomalies.
- `aurora.planet_physics_v1`: Rebuildable deterministic physical estimates for a stable transit-signal identity.
- `aurora.habitability_assessments_v1`: Explainable physics assessment and separate validated ML assessment.

### Prediction Serving & Online Telemetry
- `aurora.candidate_predictions`: High-throughput exoplanet candidate prediction scores projected from `rust-inference`.
- `aurora.anomaly_predictions`: High-throughput anomaly reconstruction MSE predictions projected from `rust-inference`.
- `aurora.targets`: Stellar target catalog cache (`tic_id`, coordinates, magnitude, disposition).
- `aurora.lightcurves` & `aurora.lightcurve_samples_v1`: Exact visualization plot samples sourced from verified Silver LC Parquet.

### Data Factory Pipeline History & Review Workflow
- `aurora.pipeline_runs_v1`: Lifecycle and throughput execution facts recorded by `gold-builder`.
- `aurora.pipeline_batches_v1`: Detailed batch-level metrics (input records, candidate rows, artifact count).
- `aurora.pipeline_component_events_v1`: Individual hop component transition events.
- `aurora.candidate_training_cohort_v1`: Reviewable labels and curated training supervisor cohort.
- `aurora.candidate_scientific_reviews_v1`: Human-in-the-loop scientific review and adjudication log.
- `aurora.lakehouse_objects`: Sub-millisecond S3 metadata lookup index across MinIO tiers.

---

## 2. Snapshot Isolation & Mandatory Query Rule

All analytical tables use `PARTITION BY snapshot_id`.

Because cumulative Gold snapshots (e.g. Snapshot A with Sectors 1–10, Snapshot B with Sectors 1–11) contain overlapping targets, analytical queries **MUST ALWAYS** specify an explicit `snapshot_id`:

```sql
-- CORRECT: Filtered by explicit snapshot ID
SELECT
    training_label,
    count() AS candidate_count
FROM aurora.candidate_features_v1
WHERE snapshot_id = 'gold-v1-a3f2c8d19280'
GROUP BY training_label;

-- FORBIDDEN: Unfiltered query double-counts cumulative snapshots
SELECT count() FROM aurora.candidate_features_v1;
```

---

## 3. Python ML Worker Loader (`analytics-load`)

Stage 5.6 indexing is managed by `python-ml-worker`:

```bash
# Load explicit committed snapshot into ClickHouse
python -m aurora_ml.main analytics-load --snapshot-id gold-v1-a3f2c8d19280

# Force drop & rebuild ClickHouse partition from canonical MinIO Gold
python -m aurora_ml.main analytics-load --snapshot-id gold-v1-a3f2c8d19280 --rebuild
```

### Loading Order & Commit Invariants
1. **Preflight Manifest Check**: Loader fetches `gold/snapshots/<snapshot-id>/manifest.json` from MinIO. If the manifest is missing or uncommitted, indexing is REJECTED.
2. **Artifact Verification**: Verifies referenced Gold Parquet files exist and verify before reading.
3. **Partition Streaming**: Streams Parquet partitions in bounded batches using PyArrow into ClickHouse.
4. **Aggregate Parity Audit**: Compares ClickHouse row count and numeric summaries against canonical Gold.
5. **READY Status Insertion**: Writes `READY` status into `aurora.gold_snapshots_v1` ONLY after verification passes 100%.

---

## 4. Rebuilding ClickHouse from Scratch

If ClickHouse container is reset or storage volume is deleted:

```bash
# 1. Initialize ClickHouse tables idempotently
docker exec -i aurora-clickhouse clickhouse-client --multiquery < infra/clickhouse/init.sql

# 2. Re-index committed Gold snapshot from MinIO
docker exec -it aurora-python-ml-worker python -m aurora_ml.main analytics-load --snapshot-id <snapshot-id>
```

Zero data loss occurs because MinIO Gold remains intact.
