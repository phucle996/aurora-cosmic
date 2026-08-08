# Contracts

This directory defines shared data contracts and event schemas for the AURORA platform.

## Event Contracts

* `events/bronze-object-ready.schema.json` — Emitted by `go-ingester` when a raw TESS FITS object is verified in MinIO Bronze. Consumed by `rust-preprocessor`.
  * **Subjects**: `aurora.v1.bronze.target-pixel.ready`, `aurora.v1.bronze.lightcurve.ready`, `aurora.v1.bronze.ffi.ready`

## Structure

* `events/`: Event schemas (e.g. `bronze-object-ready.schema.json`)
* `data/`: Data schemas and contracts (e.g. `silver-lightcurve-v1.md`, `silver-target-pixel-v1.md`, `silver-ffi-v1.md`, `lineage-v1.md`, `gold-snapshot-v1.md`, `gold-lightcurve-features-v1.md`, `gold-tpf-vetting-v1.md`, `gold-ffi-evidence-v1.md`, `catalog-snapshot-v1.md`, `catalog-tic-v1.md`, `catalog-toi-v1.md`, `catalog-tce-v1.md`, `candidate-label-v1.md`, `gold-candidate-v1.md`, `gold-anomaly-v1.md`, `analytics-query-index-v1.md`, `ml-dataset-view-v1.md`, `ml-anomaly-view-v1.md`, `ml-split-v1.md`, `training-run-v1.md`, `ml-evaluation-cohort-v1.md`, `model-evaluation-v1.md`, `model-manifest-v1.md`, `model-promotion-v1.md`, `model-runtime-v1.md`, `model-runtime-validation-v1.md`)

## Rules

1. Contracts are shared specifications only (JSON Schemas, Proto, etc.).
2. No shared business-logic code or application libraries live here.
3. Each service implements language-native representations derived from these contracts.
