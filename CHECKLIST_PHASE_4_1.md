# CHECKLIST_PHASE_4_1.md

# Stage 4 — Recovery, Idempotency & Rolling Lifecycle
## Phase 4.1 — Preprocessor Checkpoint & Processing State

Status: DONE

Goal:

> Add durable preprocessing progress state for the Rust Preprocessor.
>
> JetStream remains responsible for message delivery, ACK and redelivery.
>
> MinIO checkpoints record what the Rust application has already completed.
>
> This phase must make preprocessing recovery explicit without creating
> a distributed transaction system.
>
> Core rule:
>
> NATS remembers what still needs to happen.
>
> MinIO checkpoints remember what has already happened.


---

# 1. Phase Data Flow

Current Stage 3:

```text
NATS
 |
 v
Rust Preprocessor
 |
 v
MinIO Bronze
 |
 v
decode
 |
 v
preprocess
 |
 v
MinIO Silver
 |
 v
verify
 |
 v
ACK
```

Add durable application progress:

```text
NATS
 |
 v
Rust Preprocessor
 |
 +----> Bronze
 |
 +----> Silver
 |
 +----> preprocessing checkpoint
 |
 v
ACK
```

Recovery:

```text
Rust crash
   |
   v
NATS redelivery
   |
   v
load checkpoint
   |
   v
verify durable artifact
   |
   v
resume / skip / rebuild
```

---

# 2. Responsibility Boundary

JetStream owns:

```text
delivery

pending messages

ACK

NAK

redelivery count
```

MinIO preprocessing checkpoint owns:

```text
application progress

Silver artifact identity

processor version

source lineage

processing outcome
```

Do NOT copy JetStream consumer state into checkpoint JSON.

---

# 3. Checkpoint Storage Location

Use MinIO:

```text
checkpoints/
└── preprocessing/
```

Recommended layout:

```text
checkpoints/
└── preprocessing/
    ├── objects/
    │   └── <checkpoint-id>.json
    │
    └── runs/
        └── <run-id>.json
```

Keep V1 simple.

If run-level snapshots are unnecessary initially, the minimum acceptable layout is:

```text
checkpoints/
└── preprocessing/
    └── objects/
        └── <checkpoint-id>.json
```

---

# 4. Stable Checkpoint Identity

Checkpoint identity must be deterministic.

Recommended input:

```text
source_product_id
+
processor_version
```

Conceptual ID:

```text
TARGET_PIXEL:<source_product_id>:tpf-preprocess-v1
```

Object key may use a SHA256-safe derived identifier.

Do not use a random UUID as the only checkpoint identity.

---

# 5. Why Processor Version Is Part of Identity

This must be valid:

```text
same Bronze object
+
lc-preprocess-v1
```

and later:

```text
same Bronze object
+
lc-preprocess-v2
```

as separate processing histories.

V2 must not accidentally inherit V1 completion state.

---

# 6. Preprocessing State Model

Use explicit durable states.

Recommended:

```text
PROCESSING
    |
    v
SILVER_STORED
    |
    v
COMPLETED
```

Failure:

```text
FAILED
```

Do not persist every internal function transition.

---

# 7. Do Not Over-Checkpoint

Do NOT persist states such as:

```text
FETCH_STARTED

FETCH_42_PERCENT

HDU_OPENED

ROW_5000_DECODED

NORMALIZATION_STARTED
```

Checkpoint only meaningful application recovery boundaries.

Preferred V1:

```text
PROCESSING

SILVER_STORED

COMPLETED

FAILED
```

---

# 8. State Semantics

## `PROCESSING`

Means:

```text
Rust accepted this logical job
but no durable final Silver success is proven yet.
```

Restart behavior:

```text
inspect durable Silver
+
reprocess if necessary
```

## `SILVER_STORED`

Means:

```text
Silver was written
and checkpoint recorded its identity
```

But recovery must still verify the object.

## `COMPLETED`

Means:

```text
Silver verified
+
processing completion committed
```

This is application-level completion.

It does NOT replace JetStream ACK state.

## `FAILED`

Means:

```text
processing attempt ended with a known error
```

It is not automatically permanent.

---

# 9. ACK and Checkpoint Are Different

Possible state:

```text
checkpoint = COMPLETED
```

while:

```text
NATS message still unacked
```

Example:

```text
Silver verified
    |
    v
checkpoint COMPLETED
    |
    X
Rust crashes before ACK
```

This is expected and must be recoverable.

---

# 10. Critical Recovery Scenario

Mandatory case:

```text
Bronze
 |
 v
Rust preprocess
 |
 v
Silver PUT
 |
 v
Silver verify
 |
 v
checkpoint COMPLETED
 |
 X
CRASH
```

Then:

```text
NATS redelivery
      |
      v
load checkpoint
      |
      v
COMPLETED
      |
      v
verify Silver exists
      |
      v
ACK
```

No FITS decode.

No preprocessing.

No Silver rewrite.

---

# 11. Checkpoint Model

Suggested conceptual Rust model:

```rust
struct PreprocessingCheckpoint {
    schema_version: u32,

    checkpoint_id: String,

    source_product_id: String,
    sample_id: Option<String>,
    product_kind: ProductKind,

    bronze_bucket: String,
    bronze_object_key: String,
    bronze_sha256: String,

    processor_version: String,

    silver_bucket: Option<String>,
    silver_object_key: Option<String>,
    silver_sha256: Option<String>,
    silver_size_bytes: Option<u64>,
    silver_schema_version: Option<String>,

    state: ProcessingState,

    attempts: u32,
    last_error: Option<String>,

    created_at: DateTime,
    updated_at: DateTime,
}
```

Exact types may follow existing project conventions.

---

# 12. Required Lineage Fields

Checkpoint must retain:

```text
source_product_id

product_kind

bronze_object_key

bronze_sha256

processor_version
```

When Silver exists:

```text
silver_object_key

silver_sha256

silver_size_bytes

silver_schema_version
```

---

# 13. Checkpoint Schema Version

Every checkpoint must contain:

```text
schema_version
```

Start with:

```text
1
```

Unknown future versions must fail clearly.

Do not silently deserialize incompatible checkpoint formats.

---

# 14. Processing Attempts

Track:

```text
attempts
```

Increment per logical processing attempt.

Do not use JetStream delivery count as the only application attempt counter.

This helps diagnose:

```text
message redelivery

reprocess attempt

storage failure

science-data failure
```

---

# 15. Last Error

Store a compact:

```text
last_error
```

Example:

```text
bronze checksum mismatch
```

or:

```text
silver upload failed: timeout
```

Do not store stack traces or huge error chains in checkpoint objects.

---

# 16. Error Category

Optional but recommended:

```text
error_kind
```

Suggested values:

```text
INFRASTRUCTURE

SOURCE_INTEGRITY

FITS_DECODE

PREPROCESSING

SILVER_WRITE

SILVER_CONFLICT
```

Keep categories small.

---

# 17. Checkpoint Module

Add:

```text
apps/rust-preprocessor/src/
└── checkpoint.rs
```

Responsibilities:

```text
model

load

save

derive checkpoint key
```

Keep it in one file initially.

Do not create:

```text
checkpoint/
├── manager.rs
├── repository.rs
├── service.rs
├── helper.rs
└── utils.rs
```

unless the file genuinely becomes too large.

---

# 18. Storage Ownership

Checkpoint MinIO access may reuse the existing:

```text
storage.rs
```

client infrastructure.

But maintain clear logical APIs.

Example:

```text
storage.rs
    generic MinIO object operations

checkpoint.rs
    checkpoint object semantics
```

Do not duplicate MinIO client construction.

---

# 19. Checkpoint Store API

Keep API small.

Conceptual:

```rust
load(checkpoint_id)

save(checkpoint)

exists(checkpoint_id)
```

Optional:

```rust
delete(...)
```

is not required in this phase.

Do not build a generic key-value abstraction.

---

# 20. Checkpoint Object Key

Recommended:

```text
checkpoints/preprocessing/objects/<safe-checkpoint-id>.json
```

If direct source IDs are unsafe for paths, derive:

```text
SHA256(source_product_id + processor_version)
```

and retain the original identity inside JSON.

---

# 21. Atomic Snapshot Principle

Checkpoint readers must never observe partial JSON.

For MinIO object PUT:

```text
serialize complete JSON
    |
    v
PutObject
    |
    v
new object version replaces previous view
```

Avoid local partial writes.

If temporary local files are used:

```text
write complete
then upload
```

Do not upload while JSON is still being constructed.

---

# 22. One Checkpoint Object per Logical Product

Preferred V1:

```text
one checkpoint
=
one source product + processor version
```

This avoids a giant global checkpoint JSON containing thousands of products.

Do not rewrite a 100 MB checkpoint for every completed product.

---

# 23. No High-Frequency Checkpoint Database

MinIO checkpointing is not:

```text
transaction DB

distributed lock manager

message broker

high-frequency state store
```

Writes occur only at meaningful transitions.

---

# 24. Worker Integration

Current flow:

```text
worker.rs
    |
    v
process event
```

New flow:

```text
event
 |
 v
derive checkpoint ID
 |
 v
load checkpoint
 |
 v
decide recovery action
 |
 v
process / verify / skip
```

---

# 25. Recovery Decision Table

Implement explicit logic.

```text
NO CHECKPOINT
    -> process normally
```

```text
PROCESSING
    -> inspect Silver
    -> if valid: recover completion
    -> otherwise reprocess
```

```text
SILVER_STORED
    -> verify Silver
    -> if valid: mark COMPLETED
    -> otherwise reprocess
```

```text
COMPLETED
    -> verify Silver
    -> if valid: ACK without reprocessing
    -> otherwise checkpoint is stale -> repair/reprocess
```

```text
FAILED
    -> retry according to current retry policy
```

Do not trust checkpoint state without durable artifact verification.

---

# 26. Durable Artifact Is Truth

Core rule:

```text
checkpoint says Silver exists
```

is not enough.

Required:

```text
checkpoint says Silver exists
        |
        v
MinIO StatObject
        |
        v
metadata/size/checksum verification
```

Only then reuse it.

---

# 27. Completed Checkpoint Verification

For:

```text
state = COMPLETED
```

verify at minimum:

```text
Silver object exists

processor version matches

source Bronze SHA matches

Silver size matches checkpoint
```

Where practical:

```text
Silver SHA matches
```

Do not recompute full Silver SHA on every hot-path delivery if expensive and
stored metadata is sufficient.

Use a practical verification policy.

---

# 28. Checkpoint Before Processing

When no checkpoint exists:

```text
create PROCESSING checkpoint
```

before expensive preprocessing begins.

This makes active processing visible after restart.

Do not require checkpoint before every tiny internal step.

---

# 29. Transition to SILVER_STORED

After:

```text
Silver PUT
+
Silver verification
```

write checkpoint:

```text
SILVER_STORED
```

including:

```text
silver_object_key

silver_sha256

silver_size_bytes

schema_version
```

---

# 30. Transition to COMPLETED

After Silver durability has been committed:

```text
SILVER_STORED
      |
      v
COMPLETED
```

Then ACK JetStream.

Recommended ordering:

```text
Silver verify
     |
     v
checkpoint SILVER_STORED
     |
     v
checkpoint COMPLETED
     |
     v
ACK
```

If two writes feel redundant after implementation measurement, they may later
be collapsed carefully.

For Phase 4.1 favor correctness and clarity.

---

# 31. ACK Ordering

Final Phase 4.1 success order:

```text
Bronze verify
      |
      v
decode
      |
      v
preprocess
      |
      v
Silver write
      |
      v
Silver verify
      |
      v
checkpoint COMPLETED
      |
      v
ACK
```

ACK remains last.

---

# 32. Crash Before Checkpoint

Scenario:

```text
Silver valid
    |
    X crash before checkpoint update
```

On redelivery:

```text
checkpoint PROCESSING
      |
      v
deterministic Silver key
      |
      v
Silver found + valid
      |
      v
recover checkpoint
      |
      v
COMPLETED
      |
      v
ACK
```

No unnecessary rewrite.

---

# 33. Crash After COMPLETED Before ACK

Scenario:

```text
checkpoint COMPLETED
      |
      X
```

Redelivery:

```text
load checkpoint
     |
     v
verify Silver
     |
     v
ACK
```

This must be a fast recovery path.

---

# 34. Crash During Preprocessing

Scenario:

```text
checkpoint PROCESSING
      |
      X
```

No valid Silver exists.

After restart:

```text
verify expected Silver
      |
      v
missing
      |
      v
reprocess from Bronze
```

Do not attempt to resume an in-memory FITS decode halfway.

---

# 35. Crash During Silver Upload

If final MinIO object is not valid:

```text
PROCESSING
or
SILVER_STORED with invalid artifact
```

must result in:

```text
rebuild Silver
```

Do not trust partial upload assumptions.

---

# 36. No Partial Scientific Resume

Phase 4.1 does NOT checkpoint:

```text
which FITS row was decoded

which cadence was normalized

which Parquet row group was written
```

Recovery happens at product granularity.

This keeps the system simple.

---

# 37. Deterministic Silver Key Is Required

Recovery relies on Stage 3 invariant:

```text
same source
+
same processor version
=
same Silver object key
```

Do not introduce random Silver paths.

---

# 38. Source Change Protection

If checkpoint says:

```text
bronze_sha256 = A
```

but redelivered event says:

```text
bronze_sha256 = B
```

treat as conflict.

Do NOT reuse old checkpoint automatically.

This indicates source/product version change or inconsistent lineage.

---

# 39. Processor Version Protection

If:

```text
checkpoint.processor_version != current_processor_version
```

do not reuse completion.

Create/use the checkpoint identity for the current processor version.

V1 and V2 must remain isolated.

---

# 40. Silver Schema Protection

If checkpoint references:

```text
silver-lightcurve-v1
```

but current processor expects:

```text
silver-lightcurve-v2
```

do not blindly reuse it.

Schema compatibility must be explicit.

---

# 41. Failure Checkpoint

On processing failure, update:

```text
state = FAILED
```

with:

```text
attempts

last_error

updated_at
```

Do not overwrite valid previous COMPLETED state with a transient error.

---

# 42. Failure After Existing Valid Silver

If recovery verifies a valid Silver artifact:

```text
do not run preprocessing again
```

A later transient ACK failure should not mutate checkpoint back to FAILED.

Application processing already succeeded.

---

# 43. NATS ACK Failure

Scenario:

```text
checkpoint COMPLETED
      |
      v
ACK attempt fails
```

Do not downgrade checkpoint.

Expected:

```text
checkpoint stays COMPLETED
```

NATS may redeliver.

Next delivery verifies Silver and retries ACK.

---

# 44. NATS and Checkpoint Independence

This situation is valid:

```text
checkpoint COMPLETED
NATS pending
```

This is also valid:

```text
NATS ACKed
checkpoint COMPLETED
```

Do not try to make them atomically transactional.

Recovery logic bridges the gap.

---

# 45. Concurrency Safety

Multiple worker tasks may process different checkpoint IDs concurrently.

This is fine.

But the same logical source event may be redelivered unexpectedly.

Ensure updates for one checkpoint do not corrupt another.

---

# 46. Same-Checkpoint Concurrency

Prevent two local tasks from concurrently processing the exact same:

```text
source_product_id + processor_version
```

where practical.

Use a small in-process per-key guard if needed.

Do not introduce distributed locks.

---

# 47. No Distributed Locking

Do NOT add:

```text
Redis locks

etcd locks

MinIO lock objects

database advisory locks
```

in Phase 4.1.

Current architecture has one Rust Preprocessor service deployment in local
project scope.

Cross-instance hardening can be revisited only if needed.

---

# 48. Bounded Runtime Must Remain Intact

Checkpoint loading/saving must not bypass:

```text
AURORA_PREPROCESS_WORKERS
```

The top-level number of preprocessing jobs remains bounded.

Do not create a separate unbounded recovery task pool.

---

# 49. Checkpoint I/O Is Async

MinIO checkpoint reads/writes are I/O.

Keep them in async orchestration.

Do not place MinIO network calls inside:

```text
spawn_blocking
```

unless the actual library is blocking.

---

# 50. Blocking Science Work Remains Separate

Still use:

```text
Tokio async
    -> NATS / MinIO / orchestration

spawn_blocking
    -> FITS / preprocessing / Parquet
```

Checkpoint addition must not blur this boundary.

---

# 51. Logging

Useful logs:

```text
event_id=...

checkpoint_id=...

operation=checkpoint_load

state=COMPLETED
```

Transitions:

```text
operation=checkpoint_transition

from=PROCESSING

to=SILVER_STORED
```

Recovery:

```text
operation=checkpoint_recovery

action=reuse_silver
```

Do not log full checkpoint JSON.

---

# 52. Recovery Actions

Useful explicit internal action enum:

```text
PROCESS

REPROCESS

VERIFY_SILVER

REUSE_AND_ACK
```

This can keep worker logic readable.

Do not create a complex workflow engine.

---

# 53. Unit Test — Checkpoint Serialization

Create checkpoint.

Serialize JSON.

Read it back.

Verify:

```text
identity

state

Bronze lineage

Silver lineage

processor version

attempts
```

---

# 54. Unit Test — Schema Version

Valid:

```text
schema_version = 1
```

must load.

Unknown:

```text
schema_version = 999
```

must fail clearly.

---

# 55. Unit Test — Deterministic Checkpoint ID

Same:

```text
source_product_id

processor_version
```

must produce same checkpoint ID.

Changing processor version must produce different ID.

---

# 56. Unit Test — No Checkpoint

Input:

```text
checkpoint missing
```

Expected action:

```text
PROCESS
```

---

# 57. Unit Test — PROCESSING Without Silver

Input:

```text
state=PROCESSING

Silver missing
```

Expected:

```text
REPROCESS
```

---

# 58. Unit Test — PROCESSING With Valid Silver

Input:

```text
state=PROCESSING

Silver valid
```

Expected:

```text
recover completion
```

No scientific reprocessing.

---

# 59. Unit Test — SILVER_STORED

Input:

```text
state=SILVER_STORED
```

and valid artifact.

Expected:

```text
COMPLETED
```

then ACK path.

---

# 60. Unit Test — COMPLETED

Input:

```text
state=COMPLETED
```

and valid Silver.

Expected:

```text
REUSE_AND_ACK
```

No Bronze FITS decode.

---

# 61. Unit Test — COMPLETED But Silver Missing

Input:

```text
checkpoint COMPLETED

Silver missing
```

Expected:

```text
checkpoint cannot be trusted

REPROCESS
```

Do not ACK.

---

# 62. Unit Test — Bronze Checksum Conflict

Checkpoint:

```text
bronze_sha256=A
```

Event:

```text
bronze_sha256=B
```

Expected:

```text
conflict error

NO reuse

NO ACK
```

---

# 63. Unit Test — Processor Version Isolation

Existing:

```text
lc-preprocess-v1 checkpoint COMPLETED
```

Current job:

```text
lc-preprocess-v2
```

Expected:

```text
new processing identity
```

Do not reuse V1.

---

# 64. Unit Test — ACK Failure

Simulate:

```text
checkpoint COMPLETED
+
ACK failure
```

Verify checkpoint stays:

```text
COMPLETED
```

Redelivery can later ACK safely.

---

# 65. Integration Test — MinIO Checkpoint

Write real checkpoint to local MinIO.

Verify:

```text
object exists

JSON readable

schema correct

reload works
```

---

# 66. Integration Test — Silver Before ACK Crash

Mandatory.

Flow:

```text
Bronze event
    |
    v
Rust
    |
    v
Silver valid
    |
    v
checkpoint COMPLETED
    |
    X crash before ACK
```

Restart.

Verify:

```text
NATS redelivery

checkpoint loaded

Silver verified

NO preprocessing

ACK
```

---

# 67. Integration Test — Crash Before Checkpoint Completion

Flow:

```text
Silver valid
    |
    X crash
```

Checkpoint remains:

```text
PROCESSING
```

Restart:

```text
detect deterministic Silver

verify

promote checkpoint to COMPLETED

ACK
```

No duplicate Silver.

---

# 68. Integration Test — Crash During Processing

Flow:

```text
checkpoint PROCESSING
    |
    X
```

Silver missing.

Restart:

```text
reprocess Bronze

write Silver

checkpoint COMPLETED

ACK
```

---

# 69. Integration Test — Stale COMPLETED

Create:

```text
checkpoint COMPLETED
```

but remove Silver object.

Redeliver event.

Expected:

```text
do not ACK immediately

rebuild Silver

repair checkpoint

ACK
```

---

# 70. Integration Test — MinIO Restart

Flow:

```text
checkpoint stored
    |
    v
docker compose restart minio
    |
    v
Rust restart
```

Checkpoint must remain durable.

---

# 71. Integration Test — Rust Restart

Publish several events.

Process some to completion.

Stop Rust.

Restart.

Verify:

```text
completed products are reused

unfinished products resume

no duplicate logical Silver artifacts
```

---

# 72. Mixed Product Recovery Test

Use:

```text
LC

TPF

FFI
```

with mixed checkpoint states:

```text
COMPLETED

PROCESSING

FAILED
```

Verify each follows correct recovery action independently.

---

# 73. Checkpoint State Summary

Optional startup/runtime summary:

```text
preprocessing recovery

completed:       12
processing:       2
failed:           1
recovered:        3
reprocessed:      1
```

Useful for debugging.

Do not scan millions of checkpoints on every startup in future.

For V1 small project workloads this may remain optional.

---

# 74. No Global Startup Scan Required

Preferred recovery trigger:

```text
NATS redelivery
    |
    v
load checkpoint for that event
```

Do not require:

```text
scan every checkpoint object
```

before consumer can start.

This keeps recovery event-driven.

---

# 75. Optional Read-Only Status

A CLI/status command for Rust is not required.

If implemented, keep it read-only.

Do not build a checkpoint administration API in this phase.

---

# 76. Checkpoint Contract Documentation

Add:

```text
docs/
└── CHECKPOINTS.md
```

Document:

```text
ingestion checkpoint ownership

preprocessing checkpoint ownership

state meanings

recovery rules

NATS vs checkpoint responsibility
```

Keep it concise.

---

# 77. Key Architecture Statement

Include exactly this principle in checkpoint documentation:

```text
NATS remembers what still needs to happen.

MinIO checkpoints remember what has already happened.
```

This is a core AURORA rule.

---

# 78. Expected Rust Structure

After Phase 4.1:

```text
apps/rust-preprocessor/
└── src/
    ├── main.rs
    ├── app.rs
    ├── config.rs
    ├── event.rs
    ├── logger.rs
    ├── worker.rs
    ├── storage.rs
    ├── checkpoint.rs
    │
    ├── fits/
    ├── pipeline/
    └── output/
```

Do not refactor into more folders unless necessary.

---

# 79. Expected MinIO Layout

After processing several products:

```text
aurora/
├── bronze/
├── silver/
│
└── checkpoints/
    ├── ingestion/
    │
    └── preprocessing/
        └── objects/
            ├── <id-a>.json
            ├── <id-b>.json
            └── <id-c>.json
```

Ingestion and preprocessing checkpoints remain independent.

---

# 80. No Shared Checkpoint Library

Do NOT make Rust depend on:

```text
apps/go-ingester/internal/pipeline/checkpoint/
```

Do NOT move checkpoint implementation into a cross-language shared library.

Shared understanding comes from:

```text
stable identities

MinIO objects

contracts/docs
```

not source imports.

---

# 81. No Cross-Service Reconciliation Yet

Phase 4.1 only handles Rust preprocessing state.

Do NOT yet implement global rules involving:

```text
Go ingestion checkpoint
+
Rust preprocessing checkpoint
+
lifecycle state
```

That belongs to:

```text
Phase 4.2
```

---

# 82. No Retry Policy Expansion Yet

Do not redesign:

```text
max deliveries

backoff

DLQ

poison message policy
```

in this phase.

Basic current NAK/redelivery behavior remains.

Phase 4.3 owns production-like retry policy.

---

# 83. No Bronze Deletion

Even when checkpoint reaches:

```text
COMPLETED
```

do NOT delete Bronze.

Completion does not imply eviction eligibility yet.

Need Phase 4.4 lineage commit first.

---

# 84. No EVICTABLE State Yet

Do not mark source FITS:

```text
EVICTABLE
```

in Phase 4.1.

Current preprocessing checkpoint only records processing success.

Lifecycle state belongs later.

---

# 85. No Rolling Window Yet

Do not implement:

```text
50 GiB limit

45 GiB high watermark

30 GiB low watermark

oldest-first cleanup
```

yet.

Phase 4.5 owns storage window management.

---

# 86. Core Invariants

Invariant 1:

```text
JetStream owns delivery state.
```

Invariant 2:

```text
MinIO checkpoint owns application progress state.
```

Invariant 3:

```text
Checkpoint never replaces durable artifact verification.
```

Invariant 4:

```text
COMPLETED checkpoint requires a valid Silver artifact.
```

Invariant 5:

```text
A stale checkpoint can be repaired from durable objects.
```

Invariant 6:

```text
Crash after Silver before ACK does not cause scientific reprocessing.
```

Invariant 7:

```text
Processor versions have independent checkpoint identities.
```

Invariant 8:

```text
Same logical product is not processed concurrently inside one service instance.
```

Invariant 9:

```text
Checkpoint updates occur only at meaningful boundaries.
```

Invariant 10:

```text
Bronze is never deleted in Phase 4.1.
```

---

# Definition of Done

Phase 4.1 is COMPLETE when:

* [ ] `src/checkpoint.rs` is implemented.
* [ ] Preprocessing checkpoints are stored in MinIO.
* [ ] Checkpoint schema version exists.
* [ ] Checkpoint identity is deterministic.
* [ ] Processor version participates in checkpoint identity.
* [ ] Bronze source identity is persisted.
* [ ] Bronze checksum is persisted.
* [ ] Silver identity is persisted after successful write.
* [ ] Silver checksum is persisted.
* [ ] Silver schema version is persisted.
* [ ] `PROCESSING` state exists.
* [ ] `SILVER_STORED` state exists.
* [ ] `COMPLETED` state exists.
* [ ] `FAILED` state exists.
* [ ] Processing attempts are recorded.
* [ ] Last processing error can be recorded.
* [ ] Checkpoint is loaded on message processing/redelivery.
* [ ] Missing checkpoint starts normal processing.
* [ ] `PROCESSING` + missing Silver causes reprocessing.
* [ ] `PROCESSING` + valid Silver recovers without reprocessing.
* [ ] `SILVER_STORED` + valid Silver reaches completion.
* [ ] `COMPLETED` + valid Silver skips preprocessing.
* [ ] `COMPLETED` + missing Silver does not ACK blindly.
* [ ] Bronze checksum conflict is detected.
* [ ] Processor-version mismatch does not reuse old completion.
* [ ] Checkpoint completion is persisted before ACK.
* [ ] ACK failure does not downgrade a completed checkpoint.
* [ ] Crash-after-Silver-before-ACK recovery works.
* [ ] Crash-before-checkpoint-completion recovery works.
* [ ] Crash-during-processing recovery works.
* [ ] Stale checkpoint recovery works.
* [ ] Rust restart recovery works.
* [ ] MinIO restart preserves checkpoints.
* [ ] LC recovery works.
* [ ] TPF recovery works.
* [ ] FFI recovery works.
* [ ] Existing Stage 3 bounded concurrency remains intact.
* [ ] No distributed locking has been introduced.
* [ ] No global checkpoint database has been introduced.
* [ ] No cross-service reconciliation has been implemented yet.
* [ ] No Bronze lifecycle deletion exists.
* [ ] `docs/CHECKPOINTS.md` documents the checkpoint model.
* [ ] Repository is ready for Phase 4.2.

---

# Out of Scope

Do NOT implement in Phase 4.1:

* cross-service ingestion/preprocessing reconciliation
* global distributed transactions
* distributed locks
* NATS dead-letter stream
* advanced retry/backoff policy
* poison-message production policy
* lineage commit state
* EVICTABLE state
* Bronze deletion
* rolling 50 GiB window
* high/low watermarks
* Gold features
* TOI/TCE integration
* Python ML
* API lifecycle management

---

# Next

```text
Stage 4 — Recovery, Idempotency & Rolling Lifecycle

Phase 4.1  Preprocessor Checkpoint & Processing State        [DONE]

Phase 4.2  Cross-Service Idempotency & Reconciliation
```
