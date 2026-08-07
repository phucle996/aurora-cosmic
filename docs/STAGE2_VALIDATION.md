# Stage 2 — End-to-End Ingestion Validation Report

**Date**: 2026-08-07  
**Subsystem**: Go Ingester (`apps/go-ingester`)  
**Status**: PASSED (All Stage 2 Invariants Verified)

---

## 1. Executive Summary

Stage 2 establishes the control and data ingestion plane for the AURORA pipeline:
```text
NASA / MAST HTTP -> Go Ingester -> MinIO Bronze (FITS Binaries)
                                -> NATS JetStream (Metadata Events)
                                -> MinIO Checkpoint (State Progress)
```

All 26 unit and end-to-end tests pass cleanly. The Stage 3 (Rust Preprocessing) contract boundary is officially **frozen**.

---

## 2. Validated Core Invariants

| # | Invariant Description | Status | Verification Method |
|---|-----------------------|--------|---------------------|
| 1 | **Zero Whole-File Buffering**: FITS data streams directly `MAST -> Go -> MinIO` (`io.Reader` streaming without `io.ReadAll`). | **PASSED** | Code inspection & streaming benchmarks |
| 2 | **FITS Byte Preservation**: FITS binaries stored in MinIO Bronze preserve original MAST byte content byte-for-byte. | **PASSED** | SHA256 checksum comparison |
| 3 | **Deterministic Object Keys**: Target Pixel, Light Curve, and FFI products follow exact HIVE-style partitioning layout. | **PASSED** | `storage.BuildObjectKey` unit tests |
| 4 | **No FITS in NATS**: NATS JetStream event payloads carry strictly metadata and MinIO object references (0 binary FITS data). | **PASSED** | Payload size audit & schema validation |
| 5 | **Storage-Before-Publish Ordering**: NATS JetStream publish occurs strictly after MinIO upload and `StatObject` verification succeed. | **PASSED** | `tests/events_test.go` |
| 6 | **Crash Recovery without Re-download**: Interrupted runs in `STORED` state recover directly to `PUBLISHED` without re-downloading FITS binaries from MAST. | **PASSED** | `tests/checkpoint_test.go` |
| 7 | **Idempotent Reruns**: Rerunning an already published manifest results in 100% skipped products, 0 extra downloads, and 0 duplicate NATS publishes. | **PASSED** | `tests/e2e_ingestion_test.go` |

---

## 3. Frozen Contract for Stage 3 (Rust Preprocessor)

Stage 3 Rust preprocessor consumes events published to NATS JetStream subject `aurora.v1.bronze.*.ready`.

### NATS JetStream Subject Hierarchy:
* `aurora.v1.bronze.target-pixel.ready`
* `aurora.v1.bronze.lightcurve.ready`
* `aurora.v1.bronze.ffi.ready`

### Event Schema Contract (`contracts/events/bronze-object-ready.schema.json`):
```json
{
  "event_id": "UUID-v4",
  "event_type": "bronze.object.ready",
  "timestamp": "ISO-8601-UTC",
  "bucket": "aurora",
  "object_key": "bronze/tess/target-pixel/sector=0042/tic=123456789/tess_tp.fits",
  "product_kind": "TARGET_PIXEL",
  "sector": 42,
  "tic_id": 123456789,
  "camera": 1,
  "ccd": 3,
  "size_bytes": 1048576,
  "sha256": "377a51fe527b7db9c49321cb99b3c89d6d428d98dbd807b52abdaaf411a09125",
  "source_product_id": "tess2018206045859-s0001-0000000000000000-0120-s_tp.fits"
}
```

Rust preprocessor does **not** query MAST API; it reads object references directly from NATS JetStream and fetches binary FITS files directly from MinIO Bronze (`s3://aurora/`).

---

## 4. Test Suite Metrics

* **Total Unit & Integration Tests**: 26
* **Passing Rate**: 100% (26/26)
* **Execution Time**: ~0.21s
