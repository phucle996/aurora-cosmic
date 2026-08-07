# AURORA Checkpoint Contract & Recovery Architecture

## Core Architectural Principle

> **NATS remembers what still needs to happen.**
> **MinIO checkpoints remember what has already happened.**

---

## 1. Ownership & Storage Boundaries

AURORA maintains decoupled, service-owned durable checkpoints stored in MinIO:

- **Ingestion Service (Go)**: `checkpoints/ingestion/`
- **Preprocessor Service (Rust)**: `checkpoints/preprocessing/objects/<checkpoint_id>.json`

Go and Rust do not share checkpoint code or database engines. Shared understanding comes from deterministic object identities, contracts, and MinIO durable artifacts.

---

## 2. Preprocessing Checkpoint Data Model

Rust Preprocessor checkpoints record application progress per logical source product:

```json
{
  "schema_version": 1,
  "checkpoint_id": "8f3b2a1c...",
  "source_product_id": "tess2021204101400-s0042-0000000123456789",
  "sample_id": null,
  "product_kind": "LIGHT_CURVE",
  "bronze_bucket": "aurora",
  "bronze_object_key": "bronze/tess/lightcurve/sector=0042/tic=123456789/lc.fits",
  "bronze_sha256": "0123456789abcdef...",
  "processor_version": "lc-preprocess-v1",
  "silver_bucket": "aurora",
  "silver_object_key": "silver/tess/lightcurve/processor=lc-preprocess-v1/sector=0042/tic=123456789/prod.parquet",
  "silver_sha256": "fedcba9876543210...",
  "silver_size_bytes": 4096,
  "silver_schema_version": "silver-lightcurve-v1",
  "state": "COMPLETED",
  "attempts": 1,
  "last_error": null,
  "created_at": "2026-08-07T12:00:00Z",
  "updated_at": "2026-08-07T12:00:02Z"
}
```

---

## 3. Preprocessing State Semantics

| State | Meaning | Restart Behavior |
| :--- | :--- | :--- |
| `PROCESSING` | Worker accepted job; preprocessing or upload in progress. | Verify MinIO Silver. If valid ➔ promote to `COMPLETED`. If missing ➔ reprocess from Bronze. |
| `SILVER_STORED` | Silver Parquet uploaded & verified; checkpoint saved. | Verify Silver Parquet. If valid ➔ promote to `COMPLETED` & ACK. If missing ➔ reprocess. |
| `COMPLETED` | Preprocessing & Silver durability verified. | Fast-path: Stat Silver Parquet ➔ publish Silver event & ACK JetStream immediately without reprocessing. |
| `FAILED` | Previous processing attempt encountered an error. | Increment attempt count & reprocess from Bronze object. |

---

## 4. Recovery Decision Table

Upon NATS message redelivery, the preprocessor evaluates the recovery action:

```text
NO CHECKPOINT
    -> Process normally from Bronze object

PROCESSING
    -> Stat Silver object in MinIO
    -> If valid: promote checkpoint to COMPLETED & ACK
    -> Otherwise: reprocess from Bronze object

SILVER_STORED
    -> Stat Silver object in MinIO
    -> If valid: promote to COMPLETED & ACK
    -> Otherwise: reprocess from Bronze object

COMPLETED
    -> Stat Silver object in MinIO
    -> If valid: ACK immediately without FITS decode or scientific reprocessing
    -> Otherwise: stale checkpoint detected -> repair checkpoint & reprocess

FAILED
    -> Retry processing according to retry policy
```

---

## 5. Invariants

1. **JetStream owns delivery & redelivery state.**
2. **MinIO checkpoints record application progress.**
3. **Checkpoints never replace durable artifact verification.**
4. **`COMPLETED` status requires a verified Silver artifact in MinIO.**
5. **Crash after Silver upload before ACK does NOT trigger scientific reprocessing.**
6. **Processor versions maintain isolated checkpoint identities.**
7. **Bronze source objects are never deleted during Phase 4.1.**
