# LINEAGE.md — AURORA Data Lineage System

## Overview

Lineage is a **permanent, durable provenance record** proving that a Bronze source
product was successfully transformed into a verified Silver artifact.

Lineage records are **not checkpoints**. Checkpoints are transient processing
state. Lineage records are stable data provenance that outlives the processing
pipeline.

---

## Lineage vs Checkpoint

| Concern          | Checkpoint (`checkpoints/preprocessing/`)      | Lineage (`lineage/v1/`)                        |
|-----------------|------------------------------------------------|------------------------------------------------|
| Purpose         | Track transient processing progress             | Permanent provenance record                     |
| Lifetime        | Until GC (after lineage committed)             | Forever                                         |
| Mutability      | Updated on each retry                          | Immutable after commit                          |
| Conflict policy | Last-write-wins (bounded by max_deliveries)    | SHA256 conflict → TERMINAL, stop redelivery     |
| Key derivation  | `SHA256(source_product_id + ":" + processor_version)` | Same deterministic ID               |

---

## Data Flow

```
NATS
 │
 ▼
Rust Preprocessor
 │
 ├──► Bronze (verify stat + SHA-256)
 │
 ├──► Decode FITS
 │
 ├──► Preprocess (scientific pipeline)
 │
 ├──► Silver (Parquet, ZSTD)
 │
 ├──► Checkpoint → COMPLETED
 │
 ├──► Lineage Commit  ◄── Phase 4.4
 │         │
 │         └──► Eviction Eligibility evaluated
 │
 └──► ACK
```

---

## Object Storage Layout

```
MinIO bucket: <aurora-bucket>
│
├── checkpoints/
│   └── preprocessing/
│       └── objects/
│           └── <checkpoint_id>.json
│
└── lineage/
    └── v1/
        └── tess/
            ├── lightcurve/
            │   └── <lineage_id>.json
            ├── target-pixel/
            │   └── <lineage_id>.json
            └── ffi/
                └── <lineage_id>.json
```

---

## Lineage ID Derivation

```
lineage_id = SHA256(source_product_id + ":" + processor_version)
```

This is **identical** to `checkpoint_id`. Lineage records and their corresponding
checkpoints share the same deterministic key structure.

---

## Conflict Policy

| Scenario                        | Action                                            |
|---------------------------------|---------------------------------------------------|
| No existing record              | PUT new record                                    |
| Existing record, same SHA256    | Reuse existing, preserve `committed_at`           |
| Existing record, SHA256 differs | Return `SilverConflict` → TERM broker message     |

A SHA256 conflict means two different Silver artifacts have been committed for
the same `(source_product_id, processor_version)` pair. This requires **operator
investigation**, not automatic retry.

---

## Eviction Eligibility

Lineage commit evaluates whether the corresponding Bronze object is eligible for
deletion under policy `bronze-eviction-v1`.

### V1 Policy Rules

All conditions must be satisfied for `eligible: true`:

| Condition                | Blocked reason           |
|--------------------------|--------------------------|
| `source_uri` present     | `SOURCE_URI_MISSING`     |
| Checkpoint = COMPLETED   | `CHECKPOINT_NOT_COMPLETED` |
| Silver SHA256 non-empty  | `SILVER_MISSING`         |
| Checkpoint not FAILED    | `PROCESSING_REJECTED`    |

> **This phase does NOT delete Bronze.**
> Phase 4.5 (Rolling Bronze Window) performs actual deletion using eviction
> eligibility as an input gate.

---

## Lineage Record Fields

See [`contracts/data/lineage-v1.md`](../contracts/data/lineage-v1.md) for the
complete field reference.

---

## Recovery Behaviour

If Rust crashes after checkpoint COMPLETED but before lineage commit:

```
NATS redelivery
 │
 ▼
evaluate_recovery()
 │
 ├── checkpoint = COMPLETED  →  RecoveryAction::ReuseAndAck
 │         (Silver verified, fast ACK path)
 │
 └── lineage commit attempted on fast-path?
     Currently: NO — fast-path skips lineage to avoid double-commit risk.
     Lineage must be committed before checkpoint → COMPLETED in the normal path.
```

> **Design decision**: The normal processing path commits lineage AFTER checkpoint
> COMPLETED. If lineage commit fails, the message is NAKed. On redelivery,
> `evaluate_recovery()` will detect COMPLETED state and enter the fast-path
> (`ReuseAndAck`). The lineage will NOT be retried in the fast-path.
>
> This is acceptable because lineage failure is rare and bounded by `max_deliveries`.
> If the lineage is never committed, the Bronze object will remain ineligible for
> eviction (Phase 4.5 gate), which is the safe default.

---

## Failure Modes

| Failure                     | Class     | Broker action | Checkpoint | Lineage     |
|-----------------------------|-----------|---------------|------------|-------------|
| Bronze stat fails            | RETRYABLE | NAK           | FAILED     | Not started |
| FITS decode structural       | TERMINAL  | TERM          | FAILED+terminal | Not started |
| Scientific rejection         | REJECTED  | TERM          | FAILED+terminal | Not started |
| Silver upload fails          | RETRYABLE | NAK           | FAILED     | Not started |
| Lineage PUT fails (transient)| RETRYABLE | NAK           | COMPLETED  | Retry next  |
| Lineage SHA256 conflict      | CONFLICT  | TERM          | COMPLETED  | Operator    |
