# Contracts

This directory defines shared data contracts and event schemas for the AURORA platform.

## Event Contracts

* `events/bronze-object-ready.schema.json` — Emitted by `go-ingester` when a raw TESS FITS object is verified in MinIO Bronze. Consumed by `rust-preprocessor`.
  * **Subjects**: `aurora.v1.bronze.target-pixel.ready`, `aurora.v1.bronze.lightcurve.ready`, `aurora.v1.bronze.ffi.ready`

## Structure

* `events/`: Event schemas (e.g. `bronze-object-ready.schema.json`, `inference-job-requested.schema.json`)
* `data/`: Data schemas and contracts, including the versioned planet-physics and explainable habitability read models (`planet-physics-v1.md`, `habitability-assessment-v1.md`).

## Rules

1. Contracts are shared specifications only (JSON Schemas, Proto, etc.).
2. No shared business-logic code or application libraries live here.
3. Each service implements language-native representations derived from these contracts.
