# STAGE 3 VALIDATION REPORT — Rust Preprocessing Pipeline

Date: `2026-08-07`
Status: **PASSED / COMPLETE**
Services Covered: `apps/rust-preprocessor`

---

## 1. Executive Summary

Stage 3 (Rust Preprocessing Pipeline) has been fully implemented, validated, and hardened across all 6 phases:

1. **Phase 3.1 — JetStream Consumer & Bounded Runtime**: Bounded Tokio concurrency using `Semaphore(N)` and `JoinSet`, manual ACK/NAK/TERM policies, graceful shutdown drain.
2. **Phase 3.2 — Bronze Fetch & FITS Decode**: MinIO Bronze object stat, streaming GET with on-the-fly SHA-256 and byte-count verification, `spawn_blocking` FITS decoding (`fitsio`/`CFITSIO`).
3. **Phase 3.3 — Light Curve Preprocessing**: Pure CPU quality filtering (Strict mode `QUALITY == 0`), non-finite value removal, time sorting & deduplication preserving observation gaps, baseline median normalization (`(flux / median) - 1.0`), transit signal preservation.
4. **Phase 3.4 — TPF / FFI Image Preprocessing**: TPF cadence quality filter, temporal-median per-pixel normalization, FFI finite-aware statistics (`min`, `max`, `mean`, `stddev`, `median`), bounded cutout extraction.
5. **Phase 3.5 — Silver Schema & Materialization**: Frozen `silver-lightcurve-v1`, `silver-target-pixel-v1`, `silver-ffi-v1` Arrow schemas, Parquet ZSTD compression, deterministic key builders with `processor_version`, post-Silver durable MinIO upload ACK boundary.
6. **Phase 3.6 — End-to-End Preprocessing Validation**: Full E2E verification across all product types, failure mode protections (no ACK on Bronze mismatch, decode failure, preprocess failure, or upload failure).

---

## 2. Processor & Schema Versions

| Product Kind | Processor Version | Schema Version | Storage Format | Deterministic Silver Key Pattern |
|---|---|---|---|---|
| `LIGHT_CURVE` | `lc-preprocess-v1` | `silver-lightcurve-v1` | Parquet (ZSTD) | `silver/tess/lightcurve/processor={v}/sector={sec:04}/tic={tic}/{id}.parquet` |
| `TARGET_PIXEL` | `tpf-preprocess-v1` | `silver-target-pixel-v1` | Parquet (ZSTD) | `silver/tess/target-pixel/processor={v}/sector={sec:04}/tic={tic}/{id}.parquet` |
| `FFI` | `ffi-preprocess-v1` | `silver-ffi-v1` | Parquet (ZSTD) | `silver/tess/ffi/processor={v}/sector={sec:04}/camera={cam}/ccd={ccd}/{id}.parquet` |

---

## 3. Failure Mode & Durability Protection Matrix

| Scenario | Expected Subsystem Behavior | ACK Status |
|---|---|---|
| Malformed event JSON | Log warning, terminate poison message | `TERM` |
| Bronze object missing / stat error | Log error, NAK for redelivery | `NO ACK / NAK` |
| Bronze size or SHA-256 checksum mismatch | Download aborted/rejected, NAK | `NO ACK / NAK` |
| FITS decode error | FITS error logged, NAK for redelivery | `NO ACK / NAK` |
| Scientific preprocessing failure (e.g. `< min_points`) | Preprocessing error logged, NAK | `NO ACK / NAK` |
| Parquet serialization failure | Temp file cleaned up, NAK | `NO ACK / NAK` |
| MinIO Silver PutObject / Stat verification failure | Temp file cleaned up, NAK | `NO ACK / NAK` |
| Silver durable upload & stat verification success | Silver object verified in MinIO, ACK issued | **`ACK`** |

---

## 4. Test Suite Summary

- **Total Unit & Integration Tests**: `49 passed / 0 failed`
- **Clippy Lint Check**: `0 warnings (cargo clippy -- -D warnings)`
- **Formatting Check**: `cargo fmt --check passed`
- **Offline E2E Script**: `./tests/e2e/stage3-preprocessing.sh`
- **Makefile Target**: `make e2e-preprocessing`
