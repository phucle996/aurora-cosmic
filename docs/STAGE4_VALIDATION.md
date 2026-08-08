# STAGE4_VALIDATION.md — Stage 4 Recovery & Lifecycle Validation Report

> **AURORA Cosmic Data Platform**  
> **Stage 4 — Recovery, Idempotency & Rolling Lifecycle**  
> **Phase 4.6 — End-to-End Recovery & Lifecycle Validation Report**  
> **Validation Date:** 2026-08-08  

---

## 1. Executive Summary

Stage 4 establishes the control, recovery, and rolling storage lifecycle planes for the AURORA platform. All recovery invariants, cross-service idempotency guarantees, permanent lineage commitments, and safe rolling Bronze eviction policies have been implemented, hardened, and verified under deterministic offline test conditions.

### System Verification Matrix

| Component | Responsibility | Schema / State Version | Verification Status |
| :--- | :--- | :---: | :---: |
| **Go Ingester** | Discovery, streaming ingestion, STORED checkpoints, NATS publish | Checkpoint `v1` | **PASSED** |
| **NATS JetStream** | Bounded delivery, consumer state, redelivery, poison message handling | Contract `v1` | **PASSED** |
| **Rust Preprocessor** | FITS decoding, Parquet materialization, Fast-Path repair, Fast-Path ACK | Preprocessing `v1` | **PASSED** |
| **MinIO Lineage** | Permanent provenance surviving raw Bronze eviction | Lineage `v1` | **PASSED** |
| **Go Lifecycle Manager** | Capacity accounting, eligibility revalidation, rolling deletion | Lifecycle `v1` | **PASSED** |

---

## 2. Active Contracts & Schema Versions

### Data Contracts
- `contracts/data/silver-lightcurve-v1.md`
- `contracts/data/silver-target-pixel-v1.md`
- `contracts/data/silver-ffi-v1.md`
- `contracts/data/lineage-v1.md`
- `contracts/data/lifecycle-v1.md`

### Event Contracts
- `contracts/events/bronze-object-ready.schema.json`
- `contracts/events/preprocess-failed.schema.json`

---

## 3. Storage Watermark & Retry Policies

### Bronze Storage Watermarks
```text
MAX_BYTES           = 53,687,091,200 (50 GiB)
HIGH_WATERMARK_BYTES = 48,318,382,080 (45 GiB)
LOW_WATERMARK_BYTES  = 32,2122,54,720 (30 GiB)
```

### Delivery & Retry Policy
- `MAX_DELIVERIES`: `3`
- `BACKOFF`: Exponential retry for `RETRYABLE` errors (e.g. temporary MinIO outage, transient network issues).
- `TERMINAL`: Immediate `TERM` signal for poison JSON, unsupported product kinds, or corrupted FITS headers.
- `REJECTED`: Quality check failures (e.g. usable points < `AURORA_LC_MIN_POINTS`) marked as non-retryable science failures; Bronze preserved, not evictable under V1.
- `CONFLICT`: Checksum or version mismatches preserved without overwrite; Bronze protected.

---

## 4. Key Recovery & Lifecycle Invariants Verified

1. **Idempotency**: Repeated delivery of identical source products produces exactly one logical Bronze, one Silver artifact, and one Lineage record.
2. **Go Crash Recovery**: Go crash after Bronze upload resumes at `STORED` state and publishes NATS event without redownloading.
3. **Rust Fast-Path Repair**: Stale or missing preprocessing checkpoints are reconstructed when valid Silver Parquet and Lineage exist.
4. **Fast-Path ACK Post-Eviction**: When Bronze is deleted (`RAW_DELETED`), Rust verifies existing Silver/Lineage and returns ACK without attempting to fetch missing Bronze.
5. **Safe Eviction Ordering**: `EVICTABLE` -> `EVICTING` -> `DeleteObject` -> `RAW_DELETED`. No direct transition without verified deletion.
6. **Eviction Protection**: Candidates missing valid Silver Parquet or missing Lineage records are strictly blocked from deletion.
7. **Storage Pressure Protection**: Hard MAX capacity limit prevents new ingestion downloads when insufficient safe candidates exist to free space below LOW watermark.
8. **Lineage Durability**: `lineage/` records survive Bronze raw file eviction and serve as permanent provenance.

---

## 5. Documented System Limitations

1. **New Processor Version Post-Eviction**: If a raw Bronze object has been evicted (`RAW_DELETED`) and a new processor version (v2) is deployed, re-processing requires re-ingesting the raw FITS from upstream NASA MAST.
2. **Protected Failure States**: `REJECTED`, `FAILED`, and `CONFLICT` objects are intentionally preserved and never automatically evicted under V1 policy. Manual review or explicit purge is required if storage pressure accumulates.
3. **Silver Retention**: Stage 4 manages rolling retention for raw `bronze/` only. `silver/` Parquet files are durable science boundaries and are not automatically deleted by Stage 4.

---

## 6. Definition of Done Checklist Status

- [x] Baseline Go -> Bronze -> NATS -> Rust -> Silver -> Lineage flow verified.
- [x] Cross-service idempotency & duplicate event safety verified.
- [x] Go crash recovery (`STORED` -> `PUBLISHED`) verified.
- [x] Rust crash recovery & fast-path checkpoint repair verified.
- [x] Fast-path ACK on redelivery post-Bronze eviction verified.
- [x] Rolling Bronze eviction (`HIGH` -> `LOW`) verified.
- [x] Unsafe deletion protection (missing Silver/Lineage blocks delete) verified.
- [x] Storage pressure & hard MAX ingestion protection verified.
- [x] Offline Stage 4 E2E validation script (`tests/e2e/stage4-recovery-lifecycle.sh`) created and passing.
- [x] Stage 4 documentation synchronized.
