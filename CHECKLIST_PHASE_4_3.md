# CHECKLIST_PHASE_4_3.md

# Stage 4 — Recovery, Idempotency & Rolling Lifecycle
## Phase 4.3 — Redelivery, Retry & Poison-Message Policy

Status: TODO

Goal:

> Freeze a production-like failure policy for Rust preprocessing jobs.
>
> The system must distinguish:
>
> - temporary failures that should be retried,
> - deterministic conflicts that should stop retrying,
> - permanently invalid messages/data that should not loop forever.
>
> JetStream remains the retry/delivery engine.
>
> MinIO checkpoints remain the durable application progress record.
>
> This phase must eliminate infinite redelivery loops without hiding failures.

---

# 1. Phase Data Flow

Current:

```text
NATS message
    |
    v
Rust Preprocessor
    |
    +--> success
    |      |
    |      v
    |     ACK
    |
    +--> failure
           |
           v
          NAK
```

Upgrade to:

```text
NATS message
    |
    v
classify failure
    |
    +--> RETRYABLE
    |       |
    |       v
    |   NAK / redelivery
    |
    +--> TERMINAL
    |       |
    |       v
    |   record failure
    |       |
    |       v
    |   TERM / final ACK policy
    |
    +--> CONFLICT
            |
            v
        preserve state
            |
            v
        terminal handling
```

---

# 2. Core Principle

Do not treat every failure the same.

Required categories:

```text
temporary infrastructure failure
    -> retry

temporary storage/network failure
    -> retry

malformed event
    -> terminal

unsupported product
    -> terminal

source integrity conflict
    -> terminal/conflict

Silver lineage conflict
    -> terminal/conflict

scientifically unusable product
    -> explicit rejected/terminal state
```

No infinite redelivery loops.

---

# 3. Failure Classes

Introduce a small explicit classification.

Suggested:

```text
RETRYABLE

TERMINAL

CONFLICT
```

Optional fourth category:

```text
REJECTED
```

for scientifically unusable but structurally valid data.

Keep the model small.

---

# 4. Suggested Rust Error Model

Conceptual:

```rust
enum FailureClass {
    Retryable,
    Terminal,
    Conflict,
    Rejected,
}
```

and:

```rust
struct ProcessingFailure {
    class: FailureClass,
    code: FailureCode,
    message: String,
}
```

Do not create a large enterprise error hierarchy.

---

# 5. Retryable Failures

Examples:

```text
MinIO timeout

MinIO 5xx

temporary connection reset

NATS transient failure

temporary local disk I/O failure

temporary resource exhaustion
```

Expected action:

```text
checkpoint FAILED / retryable
        |
        v
NAK
        |
        v
JetStream redelivery
```

---

# 6. Terminal Failures

Examples:

```text
invalid JSON

missing required event field

unsupported event schema version

unsupported product kind

invalid deterministic object identity
```

Expected:

```text
record terminal failure
      |
      v
do not retry forever
```

---

# 7. Conflict Failures

Examples:

```text
Bronze checksum conflict

Silver source lineage mismatch

processor/schema conflict at deterministic key

checkpoint/artifact identity conflict
```

These must NOT be automatically overwritten.

Expected:

```text
preserve artifacts
record conflict
stop automatic retry loop
```

---

# 8. Rejected Scientific Data

Examples:

```text
valid FITS
but too few usable LC points

invalid scientific dimensions

no usable flux source

all cadences removed by deterministic filtering
```

This differs from:

```text
corrupt transport
```

The source can be structurally valid but unusable for AURORA V1 processing.

Recommended state:

```text
REJECTED
```

or terminal FAILED with:

```text
error_kind=PREPROCESSING_REJECTED
```

Choose one explicit representation.

---

# 9. Do Not Retry Rejected Science Forever

Example:

```text
LC has only 20 valid points
AURORA_LC_MIN_POINTS=100
```

Retrying 50 times will not change the outcome.

Expected:

```text
record rejection
stop broker redelivery
```

---

# 10. Delivery Count

Use JetStream delivery metadata where available.

Track:

```text
delivery_attempt
```

Do not rely solely on application checkpoint attempts.

Useful distinction:

```text
JetStream delivery count
    =
broker delivery attempts

checkpoint attempts
    =
application processing attempts
```

Both may be logged.

---

# 11. Maximum Delivery Attempts

Introduce a configurable maximum.

Suggested:

```text
AURORA_PREPROCESS_MAX_DELIVERIES=5
```

or equivalent JetStream consumer configuration.

Do not retry indefinitely.

---

# 12. Retry Limit Behavior

For retryable errors:

```text
attempt < max
    -> NAK / retry
```

```text
attempt >= max
    -> terminal failure handling
```

Persist final failure reason.

---

# 13. Backoff

Add bounded redelivery backoff.

Suggested V1 sequence:

```text
5s

30s

2m

10m
```

Exact values may be simplified.

Avoid:

```text
immediate tight-loop redelivery
```

which can hammer MinIO/CPU repeatedly.

---

# 14. Configuration

Extend:

```text
src/config.rs
```

Minimal settings:

```text
AURORA_PREPROCESS_MAX_DELIVERIES

AURORA_PREPROCESS_RETRY_BACKOFF
```

If JetStream supports backoff directly, prefer broker-native configuration.

Do not build a custom timer/retry scheduler unless necessary.

---

# 15. Prefer JetStream Retry Mechanics

Preferred:

```text
Rust
 |
 v
NAK
 |
 v
JetStream controls redelivery
```

Not:

```text
Rust stores failed message
sleeps
retries manually forever
```

Use the broker for broker work.

---

# 16. NAK vs TERM

Freeze semantics.

Use:

```text
NAK
```

for:

```text
retryable failure
```

Use:

```text
TERM
```

or equivalent final-message disposition for:

```text
malformed

unsupported

permanent conflict

rejected after policy decision
```

Do not ACK terminal failures as if processing succeeded unless the API only
supports ACK semantics and the failure is separately durably recorded.

---

# 17. Terminal Failure Durability

Before removing a poison message from active redelivery:

```text
failure must be durably recorded
```

Do not:

```text
TERM
```

then lose all diagnostic context.

---

# 18. Failure Record Storage

Use MinIO.

Suggested:

```text
checkpoints/
└── preprocessing/
    └── failures/
        └── <checkpoint-id>.json
```

Alternative:

```text
state=FAILED
```

inside the normal preprocessing checkpoint may be sufficient.

Avoid two duplicate representations unless needed.

---

# 19. Preferred V1 Failure Storage

Prefer extending preprocessing checkpoint:

```text
state = FAILED / REJECTED
failure_class
error_kind
last_error
attempts
terminal
```

Do not create another failure database.

---

# 20. Final Failure Fields

Persist:

```text
source_product_id

event_id

product_kind

checkpoint_id

processor_version

failure_class

error_kind

attempts

last_error

updated_at
```

When relevant:

```text
bronze_object_key

silver_object_key
```

---

# 21. Error Codes

Keep small, stable codes.

Suggested:

```text
EVENT_INVALID

EVENT_UNSUPPORTED

BRONZE_NOT_FOUND

BRONZE_INTEGRITY_MISMATCH

FITS_DECODE_FAILED

PREPROCESSING_REJECTED

SILVER_WRITE_FAILED

SILVER_CONFLICT

CHECKPOINT_CONFLICT

INTERNAL_TEMPORARY
```

Do not encode full human messages into machine policy.

---

# 22. Retry Classification Table

Document:

```text
ERROR                         CLASS
------------------------------------------------

temporary MinIO timeout       RETRYABLE

temporary NATS failure        RETRYABLE

Bronze 5xx                    RETRYABLE

Bronze missing                RETRYABLE initially

invalid event JSON            TERMINAL

unsupported schema            TERMINAL

unsupported product kind      TERMINAL

Bronze checksum mismatch      CONFLICT

Silver lineage mismatch       CONFLICT

too few LC points             REJECTED

invalid TPF science shape     REJECTED/TERMINAL

Parquet temporary I/O         RETRYABLE
```

Freeze exact V1 choices in docs/tests.

---

# 23. Bronze Missing Policy

A Bronze object may temporarily be unavailable due to infrastructure issues.

Initial handling:

```text
missing object
    -> retryable for limited attempts
```

After max attempts:

```text
terminal failure / source missing
```

Do not retry forever.

---

# 24. Checksum Mismatch Policy

Checksum mismatch is fundamentally different.

It means:

```text
event lineage
!=
stored bytes
```

Default:

```text
CONFLICT
```

Do not repeatedly decode/retry the same mismatched bytes.

---

# 25. FITS Decode Policy

Classify decode failures carefully.

If:

```text
temporary file read error
```

may be retryable.

If:

```text
source FITS is structurally malformed every time
```

then:

```text
TERMINAL / REJECTED
```

Do not blindly retry all `fitsio` errors.

---

# 26. Preprocessing Failure Policy

Deterministic input-driven failures:

```text
too few points

invalid normalization median

unsupported data shape
```

should normally be:

```text
REJECTED
```

not retryable.

---

# 27. Silver Write Policy

Temporary MinIO write failure:

```text
RETRYABLE
```

Deterministic conflict at existing Silver key:

```text
CONFLICT
```

Do not overwrite conflict automatically.

---

# 28. Checkpoint Failure Policy

Temporary MinIO checkpoint write failure:

```text
RETRYABLE
```

Reason:

```text
application completion cannot be durably committed
```

Do not ACK if completion checkpoint cannot be persisted.

---

# 29. ACK Failure Policy

If:

```text
Silver valid
checkpoint COMPLETED
ACK fails
```

processing is already complete.

Expected:

```text
do not downgrade checkpoint

allow NATS redelivery
```

Next delivery:

```text
verify Silver
ACK again
```

---

# 30. Poison Message Definition

A poison message is one that:

```text
will continue failing deterministically
```

Examples:

```text
invalid JSON

unsupported schema

impossible product kind

irreconcilable lineage conflict
```

The system must stop infinite redelivery.

---

# 31. Dead-Letter Strategy

A DLQ/failure stream is optional but useful.

If implemented:

```text
AURORA_PREPROCESS_FAILURES
```

subject:

```text
aurora.v1.preprocess.failed
```

Use only if the project actually consumes/inspects it.

Do not create DLQ purely for architecture decoration.

---

# 32. Recommended V1 DLQ

Given this is a system project, implement one compact failure stream:

```text
AURORA_PREPROCESS_FAILURES
```

subject:

```text
aurora.v1.preprocess.failed
```

This gives observable terminal failures without keeping poison messages active.

---

# 33. Failure Event Contract

If DLQ is implemented, add:

```text
contracts/events/
└── preprocess-failed.schema.json
```

Keep event lightweight.

Suggested fields:

```text
event_id

source_event_id

source_product_id

product_kind

checkpoint_id

failure_class

error_kind

attempts

message

occurred_at
```

No science payload.

---

# 34. Failure Event Size

Do NOT include:

```text
FITS bytes

Parquet bytes

stack trace dump

full checkpoint JSON
```

Keep failure event small.

---

# 35. Failure Publish Ordering

For terminal message:

```text
persist checkpoint failure
      |
      v
publish failure event
      |
      v
JetStream publish ACK
      |
      v
TERM original message
```

This avoids losing terminal-failure visibility.

---

# 36. Failure Event Publish Failure

If publishing terminal failure event fails:

```text
do NOT TERM original poison message yet
```

Otherwise diagnostics may be lost.

Prefer:

```text
retry terminal-handling path
```

until failure state/event is durable.

---

# 37. Avoid Failure Loop

However, failure-event infrastructure itself must not create an infinite
high-frequency loop.

Use broker backoff and delivery limits.

---

# 38. Failure Event Producer

Rust Preprocessor owns:

```text
aurora.v1.preprocess.failed
```

Go Ingester does not publish preprocessing failures.

---

# 39. No Failure Consumer Required Yet

Phase 4.3 does not require a new service to consume failure events.

They may be inspected via:

```text
NATS CLI

tests

future API/system dashboard
```

---

# 40. Consumer Configuration

JetStream durable consumer should now have explicit:

```text
AckPolicy = Explicit

MaxDeliver

BackOff / AckWait
```

Use broker configuration where available.

Do not keep these values accidental/default.

---

# 41. ACK Wait

ACK wait must account for:

```text
FITS fetch

decode

preprocessing

Parquet serialization

Silver upload
```

Do not set it too low.

If jobs may exceed ACK wait, use appropriate progress/ack extension mechanism
supported by the client/broker.

---

# 42. Long-Running Job Progress

For long jobs such as FFI processing, consider:

```text
in-progress acknowledgement / ack progress
```

if JetStream client supports it.

Purpose:

```text
prevent premature redelivery while legitimate work is still running
```

Do not use this to hide hung tasks forever.

---

# 43. Progress Heartbeat

If implemented:

```text
active job
    |
    v
periodic in-progress signal
```

Frequency must be bounded and low.

Do not checkpoint every heartbeat.

---

# 44. Processing Timeout

Introduce a practical maximum processing duration only if required.

Example:

```text
AURORA_PREPROCESS_JOB_TIMEOUT
```

Use carefully.

Do not kill valid large FFI processing because of an arbitrarily tiny timeout.

---

# 45. Timeout Classification

A processing timeout is usually:

```text
RETRYABLE
```

for limited attempts.

Repeated timeouts reaching max delivery become:

```text
terminal failure
```

with diagnostic information.

---

# 46. Worker Panic

If a Rust processing task panics:

```text
NO ACK
```

Classify:

```text
INTERNAL_TEMPORARY
```

initially.

Retry with bounded delivery count.

Repeated panic eventually becomes terminal failure.

---

# 47. Resource Exhaustion

Examples:

```text
temporary disk full

temporary memory pressure

file descriptor exhaustion
```

Classify as:

```text
RETRYABLE
```

but bounded.

Do not retry every second forever.

---

# 48. Backpressure Remains Mandatory

Retry logic must not create:

```text
retry goroutine explosion

local retry queue

unbounded temp files
```

JetStream remains the buffer.

Worker concurrency remains:

```text
<= AURORA_PREPROCESS_WORKERS
```

---

# 49. Retry Does Not Bypass Semaphore

Redelivered messages follow the same bounded worker path.

Do not create a separate “retry executor”.

---

# 50. Checkpoint Attempts

On actual processing attempt:

```text
attempts += 1
```

Do not increment simply because a completed message is redelivered and reused.

Example:

```text
COMPLETED + valid Silver -> ACK
```

should not count as new science processing.

---

# 51. Retry Error History

Do not store an unbounded array of every error.

Keep:

```text
attempts

last_error

last_error_kind
```

Optional small:

```text
first_error_at

last_error_at
```

is sufficient.

---

# 52. Terminal State

Once policy declares terminal:

```text
checkpoint.terminal = true
```

or equivalent.

Future redelivery of the same event should:

```text
recognize terminal state
avoid science reprocessing
resolve message according to policy
```

---

# 53. Terminal Conflict Reprocessing

Do not automatically retry terminal conflicts.

Manual/system reconciliation may repair them later.

Phase 4.2 state remains preserved for diagnosis.

---

# 54. Future Manual Recovery

Design failure state so a future operator/system could:

```text
fix artifact/conflict
republish event
```

without deleting history.

No manual recovery command is required yet.

---

# 55. Event Schema Version Failure

If Rust receives future:

```text
schema_version=2
```

while only V1 supported:

```text
TERMINAL
```

Do not guess field semantics.

---

# 56. Unsupported Product Failure

If:

```text
product_kind=UNKNOWN_NEW_TYPE
```

then:

```text
TERMINAL
```

and publish failure event if DLQ enabled.

No retry.

---

# 57. Invalid Identity Failure

Examples:

```text
empty object_key

invalid source_product_id

unsafe/suspicious object key
```

These are deterministic.

Classify:

```text
TERMINAL
```

---

# 58. Source Integrity Failure

Examples:

```text
event size != Bronze size

event SHA != Bronze SHA
```

Preferred:

```text
CONFLICT
```

not generic retryable failure.

---

# 59. Reconciliation Conflict Failure

From Phase 4.2:

```text
valid Silver key exists
but source SHA differs
```

Classify:

```text
CONFLICT
```

Record and stop automatic rewriting.

---

# 60. Failure Logging

Every failure log should include where available:

```text
event_id

source_product_id

checkpoint_id

product_kind

delivery_attempt

processing_attempt

failure_class

error_kind
```

Do not log secrets or entire arrays.

---

# 61. Retry Log

Example:

```text
operation=preprocess_retry

event_id=...

attempt=2

max_attempts=5

backoff=30s

error_kind=MINIO_TIMEOUT
```

---

# 62. Terminal Log

Example:

```text
operation=preprocess_terminal

event_id=...

failure_class=CONFLICT

error_kind=BRONZE_INTEGRITY_MISMATCH

action=term
```

---

# 63. Failure Metrics Placeholder

Track basic counters/log-derived metrics:

```text
retryable_failures

terminal_failures

conflicts

rejected_products

redeliveries
```

Do not add full observability stack yet.

Stage 8 owns Prometheus/Grafana hardening.

---

# 64. Unit Test — Retryable Classification

Verify:

```text
MinIO timeout
    -> RETRYABLE
```

---

# 65. Unit Test — Invalid JSON

Verify:

```text
invalid JSON
    -> TERMINAL
```

and no normal science processing.

---

# 66. Unit Test — Checksum Conflict

Verify:

```text
Bronze checksum mismatch
    -> CONFLICT
```

No automatic rewrite.

---

# 67. Unit Test — Too Few LC Points

Verify deterministic insufficient-data condition:

```text
-> REJECTED
```

or chosen terminal scientific category.

---

# 68. Unit Test — Silver MinIO Timeout

Verify:

```text
-> RETRYABLE
```

---

# 69. Unit Test — Silver Lineage Conflict

Verify:

```text
-> CONFLICT
```

---

# 70. Unit Test — Max Attempts

Given:

```text
max_deliveries=3
```

and repeat retryable failure:

```text
attempt 1 -> retry

attempt 2 -> retry

attempt 3 -> terminal handling
```

No fourth active retry.

---

# 71. Unit Test — Completed ACK Failure

Checkpoint:

```text
COMPLETED
```

ACK fails.

Verify:

```text
checkpoint remains COMPLETED

no failure downgrade
```

---

# 72. Unit Test — Terminal Checkpoint Redelivery

Given:

```text
terminal=true
```

redeliver same event.

Expected:

```text
no FITS fetch

no preprocessing

resolve broker message according to terminal policy
```

---

# 73. Unit Test — Failure Event

If DLQ implemented:

```text
terminal failure
   |
   v
build preprocess-failed event
```

Verify required fields.

---

# 74. Unit Test — Failure Event Ordering

Verify:

```text
failure checkpoint persisted
        |
        v
failure event published
        |
        v
TERM original
```

not the reverse.

---

# 75. Integration Test — MinIO Temporary Failure

Stop MinIO temporarily.

Expected:

```text
Rust receives event

storage fails

NAK

MinIO returns

redelivery

success

Silver

ACK
```

---

# 76. Integration Test — Poison JSON

Publish malformed event.

Expected:

```text
decode fails

failure state/event persisted

original message does not redeliver forever
```

---

# 77. Integration Test — Unsupported Product

Publish valid JSON with unsupported product kind.

Expected:

```text
terminal handling

no Bronze fetch

no Silver
```

---

# 78. Integration Test — Bronze Missing

Publish valid event referencing missing Bronze.

Expected:

```text
retry with backoff

after configured limit:
terminal/failure
```

---

# 79. Integration Test — Bronze Checksum Conflict

Use real Bronze object but wrong event SHA.

Expected:

```text
CONFLICT

no FITS decode

no Silver write

no endless retry
```

---

# 80. Integration Test — Rejected LC

Use valid FITS with deterministic insufficient-data condition.

Expected:

```text
REJECTED

no Silver

terminal resolution

failure observable
```

---

# 81. Integration Test — Silver Temporary Failure

Make Silver PUT fail once.

Expected:

```text
attempt 1
    -> NAK

attempt 2
    -> success
    -> Silver
    -> COMPLETED
    -> ACK
```

---

# 82. Integration Test — Max Delivery

Force repeatable retryable error beyond max attempts.

Verify:

```text
redelivery stops

terminal failure recorded
```

No endless pending loop.

---

# 83. Integration Test — Failure Stream

If failure stream exists:

```text
terminal condition
      |
      v
AURORA_PREPROCESS_FAILURES
```

Verify one valid lightweight failure event exists.

---

# 84. Duplicate Failure Event Protection

Terminal redelivery should not create unlimited duplicate failure events.

Use deterministic failure-message identity if useful.

Example:

```text
Nats-Msg-Id =
checkpoint_id + error_kind + terminal-state-version
```

Keep it simple.

---

# 85. Failure Stream Subjects

Recommended:

```text
aurora.v1.preprocess.failed
```

Do not create separate subjects per every error type.

Failure type belongs in payload.

---

# 86. Failure Stream Retention

Local development:

```text
file storage

limits retention

replicas=1
```

No complex cluster setup.

---

# 87. NATS Configuration

Update:

```text
infra/nats/nats.conf
```

or bootstrap scripts as required for:

```text
consumer MaxDeliver

backoff

optional failure stream
```

Keep broker configuration readable.

---

# 88. Contracts

If DLQ enabled, expected:

```text
contracts/events/
├── bronze-object-ready.schema.json
└── preprocess-failed.schema.json
```

Update:

```text
contracts/README.md
```

with producer/meaning.

---

# 89. README Update

Update:

```text
apps/rust-preprocessor/README.md
```

Document compact policy:

```text
retryable -> NAK

terminal -> failure record + TERM

conflict -> preserve artifacts + terminal

rejected -> terminal scientific rejection
```

---

# 90. Checkpoint Documentation

Extend:

```text
docs/CHECKPOINTS.md
```

with:

```text
failure classes

retry count

terminal semantics
```

Do not duplicate all NATS configuration details.

---

# 91. Optional Events Documentation

If useful add/update:

```text
docs/EVENTS.md
```

Document:

```text
bronze-object-ready

preprocess-failed
```

Keep it concise.

---

# 92. Expected Rust Changes

Relevant:

```text
rust-preprocessor/src/
├── worker.rs
├── checkpoint.rs
├── event.rs
├── config.rs
└── ...
```

Add a dedicated:

```text
failure.rs
```

only if failure classification becomes large enough.

Do not create:

```text
retry/
policy/
strategy/
manager/
```

hierarchy unnecessarily.

---

# 93. Preferred Code Shape

If small:

```text
worker.rs
    execution + broker action

checkpoint.rs
    durable state

event.rs
    event models

failure.rs
    failure classification
```

This is enough.

---

# 94. No Retry Logic in Science Pipeline

Do not put NATS retry semantics inside:

```text
pipeline/lightcurve.rs

pipeline/image.rs
```

Science functions return meaningful errors.

Worker layer classifies operational action.

---

# 95. No NATS Logic in FITS Layer

Similarly:

```text
fits/
```

does not ACK/NAK.

Keep transport decisions at worker/consumer boundary.

---

# 96. No Bronze Deletion

Terminal/rejected processing does NOT imply:

```text
delete Bronze
```

Keep source data until lifecycle rules decide otherwise.

---

# 97. No EVICTABLE Yet

Even:

```text
COMPLETED
```

products are not yet automatically:

```text
EVICTABLE
```

Need explicit lineage commitment in Phase 4.4.

---

# 98. No Rolling Window Yet

Do not implement:

```text
high watermark

low watermark

50 GiB cap

oldest-first deletion
```

in this phase.

---

# 99. Core Invariants

Invariant 1:

```text
Retryable failures use bounded broker redelivery.
```

Invariant 2:

```text
Poison messages do not retry forever.
```

Invariant 3:

```text
Deterministic conflicts are never silently overwritten.
```

Invariant 4:

```text
Scientifically unusable data is distinguishable from infrastructure failure.
```

Invariant 5:

```text
Terminal failure is durably recorded before message termination.
```

Invariant 6:

```text
ACK still means valid Silver completion only.
```

Invariant 7:

```text
ACK failure never downgrades completed preprocessing state.
```

Invariant 8:

```text
Retries remain inside bounded worker concurrency.
```

Invariant 9:

```text
JetStream remains the retry scheduler.
```

Invariant 10:

```text
MinIO checkpoint remains application recovery state.
```

Invariant 11:

```text
No raw data is deleted by retry policy.
```

---

# Definition of Done

Phase 4.3 is COMPLETE when:

* [ ] Failure classification exists.
* [ ] Retryable failures are distinguished from terminal failures.
* [ ] Conflict failures are explicit.
* [ ] Scientific rejection is represented explicitly.
* [ ] Maximum broker delivery count is configured.
* [ ] Retry/backoff policy is configured.
* [ ] Retryable failures use NAK/redelivery.
* [ ] Invalid JSON does not redeliver forever.
* [ ] Unsupported product types do not redeliver forever.
* [ ] Bronze checksum conflict is terminal/conflict.
* [ ] Silver lineage conflict is terminal/conflict.
* [ ] Deterministic insufficient-data failures do not retry forever.
* [ ] Temporary MinIO failures retry.
* [ ] Temporary Silver upload failures retry.
* [ ] Checkpoint write failure prevents success ACK.
* [ ] Processing attempts are persisted.
* [ ] Last error classification is persisted.
* [ ] Terminal failure state is durable.
* [ ] ACK failures preserve `COMPLETED`.
* [ ] Retry processing remains bounded.
* [ ] No local unbounded retry queue exists.
* [ ] Long-running jobs do not trigger accidental duplicate delivery.
* [ ] Poison-message tests pass.
* [ ] Retry-limit test passes.
* [ ] MinIO outage recovery test passes.
* [ ] Bronze missing retry-limit test passes.
* [ ] Checksum-conflict test passes.
* [ ] Rejected-LC test passes.
* [ ] Silver temporary failure test passes.
* [ ] Optional failure stream exists if selected.
* [ ] Terminal failure events are lightweight.
* [ ] Failure event is persisted before original message termination.
* [ ] Duplicate terminal handling does not flood failure events.
* [ ] `docs/CHECKPOINTS.md` documents failure semantics.
* [ ] Rust README documents retry/terminal behavior.
* [ ] No Bronze deletion exists.
* [ ] No lineage commit exists yet.
* [ ] No rolling storage logic exists yet.
* [ ] Repository is ready for Phase 4.4.

---

# Out of Scope

Do NOT implement in Phase 4.3:

* lineage commitment
* EVICTABLE state
* Bronze lifecycle deletion
* rolling 50 GiB window
* storage high/low watermark
* Gold dataset
* scientific feature engineering
* TOI/TCE integration
* ML training
* ONNX inference
* dashboard failure-management UI
* distributed retry scheduler
* distributed locks

---

# Next

```text
Stage 4 — Recovery, Idempotency & Rolling Lifecycle

Phase 4.1  Preprocessor Checkpoint & Processing State        [DONE]

Phase 4.2  Cross-Service Idempotency & Reconciliation        [DONE]

Phase 4.3  Redelivery, Retry & Poison-Message Policy         [DONE]

Phase 4.4  Lineage Commit & Eviction Eligibility
```
