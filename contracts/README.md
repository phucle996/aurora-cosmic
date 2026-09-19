# Contracts

This directory defines shared data contracts and event schemas for the AURORA platform.

## Event Contracts

* `events/bronze-object-ready.schema.json` — Emitted by `go-ingester` when a raw TESS FITS object is verified in MinIO Bronze. Consumed by `rust-preprocessor`.
  * **Stream**: `AURORA_BRONZE`
  * **Subjects**: `aurora.v1.bronze.target-pixel.ready`, `aurora.v1.bronze.lightcurve.ready`, `aurora.v1.bronze.ffi.ready`
* `events/silver-object-ready.schema.json` — Emitted by `rust-preprocessor` when a cleaned/normalized Parquet artifact is committed to MinIO Silver. Consumed by `aurora-enrichment`.
  * **Stream**: `AURORA_SILVER`
  * **Subjects**: `aurora.v1.silver.target-pixel.ready`, `aurora.v1.silver.lightcurve.ready`, `aurora.v1.silver.ffi.ready`
* `events/inference-job-requested.schema.json` — Emitted by `python-ml-worker` or control plane to trigger ONNX batch inference jobs. Consumed by `rust-inference`.
  * **Stream**: `AURORA_INFERENCE`
  * **Subjects**: `aurora.v1.inference.candidate.requested`, `aurora.v1.inference.anomaly.requested`
* `events/inference-job-completed.schema.json` — Emitted by `rust-inference` upon completing an inference job. Consumed by `go-api` projector.
  * **Stream**: `AURORA_INFERENCE`
  * **Subjects**: `aurora.v1.inference.candidate.completed`, `aurora.v1.inference.anomaly.completed`

## Structure

* `events/`: Event JSON schemas (e.g. `bronze-object-ready.schema.json`, `silver-object-ready.schema.json`, `inference-job-requested.schema.json`, `inference-job-completed.schema.json`)
* `data/`: Data schemas and contracts, including the versioned planet-physics and explainable habitability read models (`planet-physics-v1.md`, `habitability-assessment-v1.md`).

## Rules

1. Contracts are shared specifications only (JSON Schemas, Proto, etc.).
2. No shared business-logic code or application libraries live here.
3. Each service implements language-native representations derived from these contracts.
