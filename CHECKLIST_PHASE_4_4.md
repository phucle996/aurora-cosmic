# CHECKLIST_PHASE_4_4.md

# Stage 4 — Recovery, Idempotency & Rolling Lifecycle
## Phase 4.4 — Lineage Commit & Eviction Eligibility

Status: TODO

Goal:

> Persist a durable lineage record proving that a Bronze source product
> has been successfully transformed into a verified Silver artifact.
>
> Then determine whether the corresponding Bronze FITS object is safe to
> become `EVICTABLE`.
>
> This phase does NOT delete Bronze.
>
> It only establishes:
>
> source -> Bronze -> processor -> Silver -> lineage commit -> eligibility
>
> Phase 4.5 will perform actual rolling-window deletion.

---

# 1. Phase Data Flow

Current successful path:

```text
NATS
 |
 v
Rust Preprocessor
 |
 v
Bronze verify
 |
 v
decode
 |
 v
preprocess
 |
 v
Silver
 |
 v
checkpoint COMPLETED
 |
 v
ACK
```

Phase 4.4 changes the final path to:

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
preprocessing checkpoint COMPLETED
      |
      v
LINEAGE COMMIT
      |
      v
eviction eligibility evaluation
      |
      v
ACK
```

No Bronze deletion yet.

---

# 2. Core Requirement

Before raw FITS can ever be deleted, AURORA must permanently preserve enough
information to answer:

```text
Where did this data come from?

What exact Bronze object was processed?

What exact source bytes were processed?

Which processor version transformed it?

What Silver artifact was created?

What Silver schema was used?

Can the original source be retrieved again?
```

If these questions cannot be answered:

```text
Bronze must NOT become EVICTABLE.
```

---

# 3. Lineage Is Not a Checkpoint

Keep this distinction explicit.

Checkpoint:

```text
checkpoints/preprocessing/
```

means:

```text
how far the application got
```

Lineage:

```text
lineage/
```

means:

```text
what durable scientific artifact came from what source
```

A lineage record is intended to survive long-term.

Do NOT store permanent lineage only inside a recovery checkpoint.

---

# 4. Permanent Lineage Storage

Use MinIO.

Recommended:

```text
lineage/
└── v1/
    └── tess/
        ├── lightcurve/
        ├── target-pixel/
        └── ffi/
```

Example:

```text
lineage/v1/tess/lightcurve/<lineage-id>.json
```

```text
lineage/v1/tess/target-pixel/<lineage-id>.json
```

```text
lineage/v1/tess/ffi/<lineage-id>.json
```

---

# 5. Deterministic Lineage Identity

Lineage identity must be deterministic.

Recommended logical identity:

```text
source_product_id
+
processor_version
```

This should align with preprocessing checkpoint/Silver identity.

Do not use random UUID as the primary lineage identity.

---

# 6. Safe Lineage ID

If source product IDs are unsuitable for object paths:

```text
lineage_id =
SHA256(
    source_product_id
    +
    processor_version
)
```

Store the real:

```text
source_product_id
processor_version
```

inside the record.

---

# 7. Do Not Use Event ID as Lineage Identity

These two events:

```text
event_id=A
event_id=B
```

may refer to the exact same source product.

They must resolve to:

```text
one lineage record
```

for the same processor version.

---

# 8. Source Reprocessing

A new upstream source version should have a distinct:

```text
source_product_id
```

or explicit source version identity.

Do not collapse source versions based only on:

```text
TIC_ID + sector
```

or:

```text
camera + CCD + sector
```

Checksum conflicts for the same source identity remain conflicts.

---

# 9. Lineage Record V1

Create a durable V1 model.

Conceptual:

```rust
struct LineageRecord {
    schema_version: u32,

    lineage_id: String,
    status: LineageStatus,

    source: SourceLineage,
    bronze: BronzeLineage,
    processing: ProcessingLineage,
    silver: SilverLineage,

    eviction: EvictionEligibility,

    committed_at: DateTime,
}
```

Keep exact implementation compact.

---

# 10. Lineage Status

Phase 4.4 introduces:

```text
LINEAGE_COMMITTED
```

Meaning:

```text
the source -> Bronze -> processor -> Silver relationship
has been durably persisted and verified
```

Do not introduce:

```text
RAW_DELETED
```

yet.

That belongs to Phase 4.5.

---

# 11. Source Lineage

Persist:

```text
provider
mission

source_product_id

source_uri

source_version
```

Recommended:

```text
provider = MAST
mission  = TESS
```

If an explicit upstream source version does not exist:

```text
source_version = null
```

Do not invent one.

---

# 12. Source URI

This field is important.

Persist the source retrieval identity:

```text
source_uri
```

for the MAST product.

It must survive even after Bronze is eventually deleted.

---

# 13. Where Rust Gets Source URI

Stage 2 Bronze objects should already contain compact metadata including:

```text
source-uri
```

Rust may read this MinIO metadata during lineage construction.

Important:

```text
Rust treats source_uri as opaque lineage metadata.
```

Rust still does NOT:

```text
query MAST

download from MAST

perform source discovery
```

---

# 14. Missing Source URI

If:

```text
source_uri missing
```

do not invent one.

Result:

```text
lineage cannot satisfy automatic Bronze eviction requirements
```

The Silver artifact may remain usable.

But:

```text
Bronze = NOT EVICTABLE
```

until lineage can be repaired.

---

# 15. Bronze Lineage

Persist:

```text
bucket

object_key

size_bytes

sha256

stored_at
```

Also preserve:

```text
product_kind

sector

tic_id
```

or:

```text
camera
ccd
```

where applicable.

---

# 16. Bronze SHA Is Mandatory

A lineage record must preserve:

```text
bronze_sha256
```

This proves which exact source bytes were transformed.

Do not rely only on:

```text
filename

TIC

sector
```

---

# 17. Bronze Object Key Is Mandatory

Persist:

```text
bronze_object_key
```

even though the object may later be deleted.

This keeps historical data-plane lineage understandable.

---

# 18. Processing Lineage

Persist:

```text
service

processor_version

product_kind

processing parameters / policy
```

Recommended:

```text
service = rust-preprocessor
```

---

# 19. Processor Version

Mandatory.

Examples:

```text
lc-preprocess-v1

tpf-preprocess-v1

ffi-preprocess-v1
```

Do not write generic:

```text
processor=v1
```

if product pipelines have independent versions.

---

# 20. Output-Affecting Configuration

Any configuration that can change scientific output must be reproducible.

Examples:

```text
quality mode

normalization mode

SAP fallback

minimum LC points

sigma clipping policy

FFI cutout size
```

Do not include operational-only settings such as:

```text
worker count

NATS URL

temporary directory
```

---

# 21. Processor Version Discipline

Freeze this rule:

```text
If an output-affecting preprocessing policy changes,
the processor version must change.
```

Example:

```text
lc-preprocess-v1
```

must never silently switch from:

```text
QUALITY == 0
```

to a different bitmask policy.

---

# 22. Processing Parameters Snapshot

Recommended lineage field:

```text
processing_parameters
```

containing a canonical snapshot.

Example concept:

```json
{
  "quality_mode": "strict",
  "normalization": "median",
  "sap_fallback": false,
  "sigma_clip": null
}
```

Do not dump the entire service configuration.

---

# 23. Optional Processing Fingerprint

Recommended:

```text
processing_fingerprint
```

derived from canonical scientific configuration.

Example:

```text
SHA256(
    processor_version
    +
    canonical output-affecting config
)
```

This is useful for audit/reproducibility.

Do not include operational config in the fingerprint.

---

# 24. Silver Lineage

Persist:

```text
bucket

object_key

size_bytes

sha256

schema_version
```

Also:

```text
processor_version
```

must agree with processing lineage.

---

# 25. Silver Schema Version

Examples:

```text
silver-lightcurve-v1

silver-target-pixel-v1

silver-ffi-v1
```

Do not mark lineage committed if the expected schema version conflicts with
the actual Silver artifact.

---

# 26. Full Lineage

After commit, one record must describe:

```text
MAST source URI
      |
      v
source_product_id
      |
      v
Bronze object key
      |
      v
Bronze SHA256
      |
      v
processor version
      |
      v
processing policy
      |
      v
Silver object key
      |
      v
Silver SHA256
      |
      v
Silver schema
```

This is the minimum durable scientific provenance path for Stage 4.

---

# 27. Lineage Contract

Add:

```text
contracts/data/
└── lineage-v1.md
```

Document:

```text
field

type

required/optional

semantic meaning
```

Keep the JSON model implementation in Rust as executable source-of-truth.

---

# 28. Contract README

Update:

```text
contracts/README.md
```

Add:

```text
lineage-v1
```

and explain that it is a persistent data-plane contract, not a NATS event.

---

# 29. No Lineage Event

Do NOT create:

```text
aurora.v1.lineage.committed
```

unless a later consumer has a real need.

Phase 4.5 can read durable MinIO lineage records.

Avoid event proliferation.

---

# 30. Lineage Module

Add:

```text
apps/rust-preprocessor/src/
└── lineage.rs
```

Responsibilities:

```text
build lineage record

validate lineage prerequisites

derive lineage object key

load existing lineage

commit idempotently

evaluate eviction eligibility
```

Keep it in one file initially.

---

# 31. Expected Rust Tree

Relevant tree after Phase 4.4:

```text
rust-preprocessor/src/
├── app.rs
├── config.rs
├── event.rs
├── worker.rs
├── checkpoint.rs
├── lineage.rs
├── storage.rs
│
├── fits/
├── pipeline/
└── output/
```

Do not create:

```text
lineage/
├── manager.rs
├── service.rs
├── repository.rs
└── utils.rs
```

unless complexity genuinely requires it.

---

# 32. Storage Ownership

Reuse the existing MinIO client.

Logical responsibilities:

```text
storage.rs
    generic object access

lineage.rs
    lineage semantics
```

Do not create a second MinIO connection pool for lineage.

---

# 33. Lineage Commit Preconditions

Successful lineage commit requires:

```text
valid Bronze identity

valid Bronze checksum

source URI preserved

preprocessing checkpoint COMPLETED

valid Silver object

Silver lineage matches Bronze

processor version matches

Silver schema version matches
```

Every prerequisite must be explicit.

---

# 34. Preprocessing Checkpoint Requirement

Require:

```text
state = COMPLETED
```

before committing successful lineage.

Do not commit success lineage for:

```text
PROCESSING

FAILED

REJECTED
```

---

# 35. Rejected Products

A rejected scientific product may have a durable failure record.

However V1 automatic raw eviction policy should be conservative.

Default:

```text
REJECTED
    -> NOT EVICTABLE
```

Do not automatically delete rejected source data.

This allows later diagnosis.

---

# 36. Conflict Products

For:

```text
Bronze conflict

Silver conflict

checkpoint conflict
```

automatic eligibility is always:

```text
NOT EVICTABLE
```

Never delete evidence involved in a reconciliation conflict.

---

# 37. Bronze Verification Before Commit

At lineage commit time verify Bronze still exists.

At minimum:

```text
object exists

size matches

sha256 lineage matches
```

Where SHA verification can use trusted stored metadata from the already
verified Stage 3/4 processing path, avoid unnecessarily rereading huge FFI
bytes again.

But do not commit if the metadata conflicts.

---

# 38. Silver Verification Before Commit

Verify:

```text
Silver exists

size matches

schema matches

processor matches

Bronze SHA lineage matches

Silver SHA identity matches
```

Lineage commit must not point to a missing artifact.

---

# 39. Checkpoint vs Silver Conflict

If:

```text
checkpoint says Silver=A
```

but:

```text
actual deterministic Silver=B
```

result:

```text
LINEAGE CONFLICT
```

Do not choose one arbitrarily.

No eviction.

---

# 40. Source Metadata vs Event Conflict

If Bronze metadata says:

```text
source_product_id=A
```

but event says:

```text
source_product_id=B
```

do not commit lineage.

Classify as:

```text
LINEAGE_SOURCE_CONFLICT
```

or equivalent.

---

# 41. Existing Lineage Record

Before writing:

```text
derive deterministic lineage key
      |
      v
check existing record
```

If missing:

```text
create
```

If existing and logically identical:

```text
reuse
```

If existing and conflicting:

```text
fail
```

Do not silently overwrite permanent lineage.

---

# 42. Idempotent Commit

Repeated delivery must be safe.

Flow:

```text
delivery 1
    |
    v
lineage committed
    |
    X
crash
```

Redelivery:

```text
derive same lineage key
      |
      v
record exists
      |
      v
validate same lineage
      |
      v
reuse
```

No duplicate records.

---

# 43. Existing Lineage Comparison

Ignore only intentionally non-semantic runtime values.

These must match:

```text
source_product_id

source_uri

bronze key

bronze SHA

processor version

Silver key

Silver SHA

Silver schema
```

Do not treat different SHA values as equivalent.

---

# 44. Committed Timestamp

Store:

```text
committed_at
```

only when the lineage is first created.

An idempotent re-run should not rewrite:

```text
committed_at
```

every time.

---

# 45. Eviction Eligibility Model

Introduce explicit evaluation.

Conceptual:

```rust
struct EvictionEligibility {
    policy_version: String,
    eligible: bool,
    reason: String,
}
```

Recommended policy:

```text
bronze-eviction-v1
```

---

# 46. V1 Eligibility Meaning

`EVICTABLE` means:

```text
The Bronze source may be deleted by the lifecycle manager
without losing the durable downstream processed representation
or source retrieval lineage.
```

It does NOT mean:

```text
delete immediately
```

Phase 4.5 decides when deletion occurs.

---

# 47. Successful EVICTABLE Requirements

For V1:

```text
source URI preserved
AND

source product identity preserved
AND

Bronze SHA preserved
AND

Bronze currently valid
AND

preprocessing checkpoint COMPLETED
AND

Silver currently valid
AND

Silver SHA preserved
AND

Silver schema preserved
AND

processor version preserved
AND

lineage record durably committed
```

Then:

```text
eligible = true
```

---

# 48. Gold Is NOT Required for V1 Bronze Eviction

Freeze this architecture rule for Stage 4:

```text
Silver is the durable downstream boundary required for Bronze eviction.
```

Gold is not yet required because:

```text
Stage 5 consumes Silver
```

and should not require normal access to Bronze FITS.

Therefore:

```text
Bronze
    -> Silver durable
    -> lineage committed
    -> may become EVICTABLE
```

Do not block Stage 4 waiting for Gold.

---

# 49. Future Policy Evolution

A future workflow may define:

```text
bronze-eviction-v2
```

with stronger requirements.

For example:

```text
Gold required
```

for a special workflow.

Do not hard-code current V1 policy forever.

Persist:

```text
policy_version
```

---

# 50. EVICTABLE Is Per Source Product

Eligibility operates independently for:

```text
one LC product

one TPF product

one FFI product
```

Do not require sector-wide completion.

---

# 51. TPF and LC Independence

TPF and LC may share:

```text
sample_id
```

but eviction eligibility remains product-level.

Example:

```text
TPF Silver valid
LC processing failed
```

Then:

```text
TPF may become EVICTABLE

LC remains NOT EVICTABLE
```

Do not roll them back together.

---

# 52. FFI Independence

FFI eligibility uses its own:

```text
source_product_id

sector

camera

ccd

processor version

Silver artifact
```

No dependency on target-level LC/TPF.

---

# 53. Missing Source URI Eligibility

If:

```text
source_uri missing
```

then:

```text
eligible = false
reason = SOURCE_RETRIEVAL_NOT_PRESERVED
```

No deletion.

---

# 54. Missing Silver Eligibility

If:

```text
Silver missing
```

then:

```text
eligible = false
reason = SILVER_NOT_DURABLE
```

No deletion.

---

# 55. Incomplete Checkpoint Eligibility

If:

```text
checkpoint != COMPLETED
```

then:

```text
eligible = false
```

Do not let:

```text
PROCESSING
```

products become evictable.

---

# 56. Failed/Rejected Eligibility

Default:

```text
FAILED
REJECTED
CONFLICT
```

all produce:

```text
eligible = false
```

for automatic V1 deletion.

Phase 4.5 must respect this.

---

# 57. Source Integrity Conflict Eligibility

If:

```text
Bronze SHA mismatch
```

then:

```text
eligible = false
```

Preserve source artifact for diagnosis.

---

# 58. Silver Integrity Conflict Eligibility

If:

```text
Silver SHA / lineage mismatch
```

then:

```text
eligible = false
```

Do not delete Bronze.

---

# 59. Lineage Commit Before ACK

Change success ordering to:

```text
Silver verified
      |
      v
checkpoint COMPLETED
      |
      v
lineage committed
      |
      v
ACK
```

This ensures an ACKed successfully processed product has permanent lineage.

---

# 60. Lineage Write Failure

Scenario:

```text
Silver valid
checkpoint COMPLETED
lineage PUT fails
```

Do NOT:

```text
downgrade COMPLETED
```

Scientific processing already succeeded.

Do:

```text
NO ACK
```

and classify lineage persistence failure as retryable where appropriate.

---

# 61. Redelivery After Lineage Write Failure

Expected:

```text
NATS redelivery
      |
      v
checkpoint COMPLETED
      |
      v
verify Silver
      |
      v
NO scientific reprocessing
      |
      v
retry lineage commit
      |
      v
ACK
```

This must be a cheap recovery path.

---

# 62. Crash After Lineage Before ACK

Scenario:

```text
checkpoint COMPLETED

lineage committed

X crash before ACK
```

Redelivery:

```text
load checkpoint
      |
      v
verify Silver
      |
      v
verify existing lineage
      |
      v
ACK
```

No Bronze decode.

No preprocessing.

No new lineage object.

---

# 63. Crash Before Lineage

Scenario:

```text
Silver valid

checkpoint COMPLETED

X
```

Redelivery:

```text
reuse Silver

commit lineage

ACK
```

No scientific work repeated.

---

# 64. Lineage Conflict Failure Class

Extend Phase 4.3 failure codes with something equivalent to:

```text
LINEAGE_CONFLICT
```

and optionally:

```text
LINEAGE_METADATA_MISSING
```

Conflicts must not be retried forever.

---

# 65. Missing Required Lineage Metadata

If permanent required metadata is absent:

```text
source_uri missing
```

processing itself may already be valid.

Do not delete Silver.

Do not delete Bronze.

Record a clear blocked/conflict reason.

The product remains:

```text
NOT EVICTABLE
```

---

# 66. No Automatic Repair from MAST

Rust must not respond to missing source metadata by:

```text
querying MAST
```

The ingestion side remains the source owner.

A future repair command may reconstruct metadata separately if needed.

---

# 67. No Cross-Service Checkpoint Mutation

Rust still must not modify:

```text
checkpoints/ingestion/
```

Lineage commit should be built from:

```text
event

Bronze metadata

preprocessing checkpoint

Silver metadata
```

Do not make Rust an ingestion-state owner.

---

# 68. Bronze Metadata Contract

Ensure Bronze metadata provides enough opaque source lineage.

Minimum useful fields:

```text
source-product-id

source-uri

product-kind

sha256
```

plus target/image identity where available.

Do not expand Bronze metadata excessively.

---

# 69. Source Version Metadata

If Stage 2 already has a real:

```text
source_version
```

preserve it in Bronze metadata and lineage.

If not:

```text
null
```

is acceptable.

Do not infer source version from filename unless that logic is already
well-defined.

---

# 70. Processing Metadata Cross-Check

Where Silver contains metadata such as:

```text
processor-version

schema-version

bronze-sha256
```

lineage builder must cross-check them.

Do not merely copy values from the checkpoint without verification.

---

# 71. Lineage JSON Must Be Small

A lineage record should contain metadata only.

Do NOT include:

```text
flux arrays

pixel arrays

FITS header dump

Parquet rows

full event payload

full checkpoints
```

Expected size should be small.

---

# 72. Do Not Embed Whole Manifest

Do not put the ingestion manifest into each lineage record.

Store only stable source/product identifiers needed for provenance.

The manifest remains a separate durable artifact.

---

# 73. Manifest Reference

Optional useful field:

```text
manifest_id
```

or:

```text
manifest_hash
```

if already available cleanly.

Do not redesign Stage 2 checkpoints just to make this mandatory.

---

# 74. Checkpoint References

Optional lineage references:

```text
preprocessing_checkpoint_id
```

are useful for diagnostics.

Do not make permanent lineage dependent on the checkpoint file continuing to
exist forever.

Lineage must be understandable independently.

---

# 75. Lineage Durability Verification

After PUT:

```text
StatObject
```

or equivalent.

Verify:

```text
object exists

expected size
```

Then read/deserialize where appropriate in integration tests.

Do not consider lineage committed before successful persistence.

---

# 76. Optional Lineage SHA256

Recommended:

```text
lineage_sha256
```

may be calculated for audit.

Not strictly required if the JSON object itself is durably stored and
validated.

Do not overcomplicate V1 solely for this field.

---

# 77. No Overwrite on Conflict

If lineage object already exists with:

```text
bronze_sha=A
```

and new attempted commit says:

```text
bronze_sha=B
```

result:

```text
CONFLICT
```

Do NOT:

```text
PUT overwrite
```

Permanent provenance must not be rewritten silently.

---

# 78. Eligibility Must Be Recheckable

Even if lineage stores:

```text
eligible=true
```

Phase 4.5 must recheck relevant conditions before actual delete.

Reason:

```text
state may change between eligibility evaluation and deletion
```

Do not treat a historical boolean as a deletion authorization forever.

---

# 79. Eligibility Policy Result

Useful reasons:

```text
SUCCESSFUL_SILVER_DURABLE

SOURCE_URI_MISSING

CHECKPOINT_NOT_COMPLETED

SILVER_MISSING

SILVER_CONFLICT

BRONZE_CONFLICT

PROCESSING_REJECTED

LINEAGE_CONFLICT
```

Keep reason codes small.

---

# 80. Do Not Introduce Lifecycle Database

No:

```text
PostgreSQL lifecycle table

Redis lifecycle set

ClickHouse eviction queue
```

Lineage lives in MinIO.

Phase 4.5 can derive cleanup candidates from durable metadata/records.

---

# 81. No Distributed Lock

Do not add a global lock around lineage commit.

Deterministic object identity + compare/validate behavior is sufficient for
the current deployment model.

---

# 82. Same-Lineage Local Concurrency

Existing per-product processing guard should prevent duplicate local commits
during active work.

Even without the guard:

```text
same logical commit
```

must remain idempotent.

---

# 83. Unit Test — Lineage ID

Same:

```text
source_product_id

processor_version
```

must produce identical:

```text
lineage_id
```

Different processor version must produce different identity.

---

# 84. Unit Test — Lineage Serialization

Build a V1 record.

Serialize.

Deserialize.

Verify:

```text
source lineage

Bronze lineage

processor lineage

Silver lineage

eligibility

status
```

---

# 85. Unit Test — Unsupported Lineage Schema

Given:

```text
schema_version=999
```

loading must fail clearly.

Do not silently interpret future lineage formats.

---

# 86. Unit Test — Successful Eligibility

Given:

```text
source URI present

Bronze valid

checkpoint COMPLETED

Silver valid

lineage committed
```

expected:

```text
EVICTABLE
```

---

# 87. Unit Test — Missing Source URI

Expected:

```text
NOT EVICTABLE
```

Reason:

```text
SOURCE_URI_MISSING
```

---

# 88. Unit Test — Missing Silver

Expected:

```text
NOT EVICTABLE
```

---

# 89. Unit Test — PROCESSING Checkpoint

Expected:

```text
NOT EVICTABLE
```

even if an incomplete/unknown Silver object happens to exist.

---

# 90. Unit Test — REJECTED Product

Expected:

```text
NOT EVICTABLE
```

under V1 automatic policy.

---

# 91. Unit Test — Bronze Conflict

Wrong Bronze SHA:

```text
NOT EVICTABLE
```

and lineage commit must fail.

---

# 92. Unit Test — Silver Conflict

Wrong source SHA in Silver metadata:

```text
NOT EVICTABLE
```

No lineage success.

---

# 93. Unit Test — Existing Identical Lineage

Commit same logical lineage twice.

Expected:

```text
one object

second commit succeeds idempotently

original committed_at preserved
```

---

# 94. Unit Test — Existing Conflicting Lineage

Create lineage with:

```text
silver_sha=A
```

attempt commit:

```text
silver_sha=B
```

Expected:

```text
LINEAGE_CONFLICT
```

No overwrite.

---

# 95. Unit Test — Processing Parameters

Verify output-affecting parameters are captured.

Operational configuration must not appear in the lineage fingerprint.

Example:

Changing:

```text
AURORA_PREPROCESS_WORKERS
```

must not imply a different scientific lineage.

---

# 96. Integration Test — LC Lineage Commit

Flow:

```text
Bronze LC
 |
 v
Rust
 |
 v
Silver LC
 |
 v
checkpoint COMPLETED
 |
 v
lineage/v1/tess/lightcurve/<id>.json
 |
 v
ACK
```

Verify all identifiers match.

---

# 97. Integration Test — TPF Lineage Commit

Repeat for:

```text
TARGET_PIXEL
```

Verify:

```text
TIC

sector

source SHA

Silver SHA

processor version
```

---

# 98. Integration Test — FFI Lineage Commit

Repeat for:

```text
FFI
```

Verify:

```text
sector

camera

ccd

source URI

Silver identity
```

---

# 99. Integration Test — Crash Before Lineage

Create:

```text
Silver valid
checkpoint COMPLETED
```

but no lineage.

Redeliver.

Expected:

```text
NO decode

NO preprocess

lineage commit

ACK
```

---

# 100. Integration Test — Crash After Lineage Before ACK

Create full lineage.

Do not ACK.

Restart Rust.

Expected:

```text
redelivery

checkpoint valid

Silver valid

lineage valid

ACK
```

No scientific reprocessing.

---

# 101. Integration Test — Lineage PUT Failure

Force temporary MinIO lineage PUT failure.

Expected:

```text
Silver remains valid

checkpoint remains COMPLETED

NO ACK

redelivery later retries lineage only
```

---

# 102. Integration Test — Missing Source URI

Use Bronze object missing required source URI metadata.

Expected:

```text
Silver may already be valid

lineage commit blocked

Bronze NOT EVICTABLE
```

No deletion.

---

# 103. Integration Test — Existing Conflicting Lineage

Place conflicting lineage at deterministic key.

Expected:

```text
CONFLICT

NO overwrite

NO eviction eligibility
```

---

# 104. Integration Test — Processor V1/V2

Same source product processed by:

```text
processor v1

processor v2
```

Expected:

```text
two independent lineage records

two independent Silver artifacts
```

No overwrite.

---

# 105. Integration Test — Reprocessed Source

Two real/logical source product versions for the same target/sector.

Expected:

```text
separate source lineage
```

Do not collapse by sample ID.

---

# 106. Mixed Product Eligibility Test

Create:

```text
LC       -> COMPLETED + valid Silver
TPF      -> PROCESSING
FFI      -> REJECTED
```

Expected:

```text
LC       -> EVICTABLE

TPF      -> NOT EVICTABLE

FFI      -> NOT EVICTABLE
```

Eligibility remains product-level.

---

# 107. No Deletion Test

After successful Phase 4.4 run verify:

```text
Bronze object count unchanged
```

even for:

```text
eligible=true
```

This phase must never call Bronze DeleteObject.

---

# 108. Storage API Safety

Do not expose Bronze deletion through lineage commit code.

Preferred:

```text
lineage.rs
    has no delete Bronze call
```

Actual deletion belongs to a separate Phase 4.5 lifecycle path.

---

# 109. Worker Integration

Final Rust success path should be readable:

```text
process event

reconcile checkpoint/Silver

if scientific work needed:
    fetch Bronze
    decode
    preprocess
    write Silver
    verify Silver

checkpoint COMPLETED

commit/verify lineage

ACK
```

Do not bury lineage commit inside Parquet serialization.

---

# 110. Recovery Fast Path

Completed product redelivery:

```text
event
 |
 v
checkpoint COMPLETED
 |
 v
verify Silver
 |
 v
verify lineage
 |
 +--> missing lineage
 |       |
 |       v
 |   commit lineage
 |
 v
ACK
```

No FITS processing.

---

# 111. Failure Policy Integration

Add relevant Phase 4.3 codes.

Suggested:

```text
LINEAGE_WRITE_FAILED
    -> RETRYABLE
```

```text
LINEAGE_CONFLICT
    -> CONFLICT
```

```text
LINEAGE_METADATA_MISSING
    -> TERMINAL/BLOCKED after configured policy
```

Do not retry deterministic missing metadata forever.

---

# 112. Logging — Commit

Useful:

```text
operation=lineage_commit

lineage_id=...

source_product_id=...

bronze_object_key=...

silver_object_key=...

processor_version=...

status=LINEAGE_COMMITTED
```

---

# 113. Logging — Eligibility

Useful:

```text
operation=eviction_eligibility

lineage_id=...

eligible=true

policy=bronze-eviction-v1
```

Blocked:

```text
eligible=false

reason=SILVER_MISSING
```

Do not log entire lineage JSON.

---

# 114. Basic Counters

Optional log-derived counters:

```text
lineage_committed

lineage_reused

lineage_conflicts

eviction_eligible

eviction_blocked
```

Formal metrics remain Stage 8.

---

# 115. Documentation

Add:

```text
docs/LINEAGE.md
```

Document compactly:

```text
what lineage means

record layout

required fields

commit ordering

eviction eligibility policy
```

Do not expand `ARCH.MD` with internal implementation details.

---

# 116. CHECKPOINTS Documentation

Update:

```text
docs/CHECKPOINTS.md
```

Clarify:

```text
checkpoint COMPLETED
    !=
lineage committed
```

and:

```text
lineage record
    !=
checkpoint
```

---

# 117. Key Architecture Statement

Document:

```text
NATS remembers what still needs to happen.

MinIO checkpoints remember what has already happened.

MinIO lineage records remember what durable data came from what source.
```

Keep these responsibilities separate.

---

# 118. Contracts After Phase

Expected:

```text
contracts/
├── events/
│   ├── bronze-object-ready.schema.json
│   └── preprocess-failed.schema.json      # if Phase 4.3 selected DLQ
│
└── data/
    ├── silver-lightcurve-v1.md
    ├── silver-target-pixel-v1.md
    ├── silver-ffi-v1.md
    └── lineage-v1.md
```

---

# 119. MinIO Layout After Phase

Conceptually:

```text
aurora/
├── bronze/
│
├── silver/
│
├── checkpoints/
│   ├── ingestion/
│   └── preprocessing/
│
└── lineage/
    └── v1/
        └── tess/
            ├── lightcurve/
            ├── target-pixel/
            └── ffi/
```

No raw deletion yet.

---

# 120. No Lifecycle Checkpoint Yet Unless Needed

Do not pre-create:

```text
checkpoints/lifecycle/
```

just to satisfy the future roadmap.

Phase 4.5 will introduce mutable lifecycle deletion state when actual deletion
exists.

Phase 4.4 permanent lineage is sufficient for eligibility evaluation.

---

# 121. Why Lifecycle Checkpoint Waits

Lineage is permanent provenance.

Deletion state such as:

```text
DELETE_STARTED

RAW_DELETED
```

is operational lifecycle progress.

That responsibility begins only when Phase 4.5 performs deletion.

Do not mix them prematurely.

---

# 122. No Gold Dependency

Do not inspect:

```text
Gold

ML labels

models

predictions
```

for V1 Bronze eligibility.

Stage 5 will use Silver as its input boundary.

---

# 123. No Silver Deletion

Phase 4.4 only evaluates Bronze eligibility.

Do NOT delete:

```text
Silver
```

Silver retention is a separate future policy.

---

# 124. No Manifest Deletion

Never mark ingestion manifests as raw-eviction targets.

Preserve:

```text
manifest

checkpoints

lineage

Silver
```

when Bronze eventually rotates out.

---

# 125. No Failure Evidence Deletion

Do not delete:

```text
FAILED checkpoints

rejection information

conflict information
```

during lineage processing.

Failure evidence is required for diagnostics.

---

# 126. No Automatic Rejected-Raw Eviction

V1 deliberately chooses:

```text
rejected raw -> preserve
```

rather than deleting automatically.

If rejected/conflict data later occupies too much storage:

```text
Phase 4.5 must report insufficient safe eviction capacity
```

rather than deleting unsafe evidence.

---

# 127. Future Storage Pressure Rule

Phase 4.5 must be prepared for:

```text
Bronze > HIGH watermark
but insufficient EVICTABLE objects
```

Correct future behavior:

```text
surface storage pressure
stop/slow ingestion if necessary
```

Wrong:

```text
delete non-evictable Bronze anyway
```

Phase 4.4 eligibility is the safety gate.

---

# 128. Core Invariants

Invariant 1:

```text
Lineage is permanent data provenance, not recovery state.
```

Invariant 2:

```text
One source product + processor version maps to one logical lineage record.
```

Invariant 3:

```text
Lineage records are idempotent.
```

Invariant 4:

```text
Existing conflicting lineage is never silently overwritten.
```

Invariant 5:

```text
Source URI survives before Bronze can become EVICTABLE.
```

Invariant 6:

```text
Bronze SHA survives before Bronze can become EVICTABLE.
```

Invariant 7:

```text
Valid Silver is required for successful V1 automatic eviction eligibility.
```

Invariant 8:

```text
Processor and schema versions are preserved.
```

Invariant 9:

```text
Rejected/conflicted products are not automatically EVICTABLE.
```

Invariant 10:

```text
Gold is not required for V1 Bronze eviction.
```

Invariant 11:

```text
ACK occurs after lineage commitment.
```

Invariant 12:

```text
Lineage failure does not cause completed science preprocessing to run again.
```

Invariant 13:

```text
EVICTABLE does not mean immediately deleted.
```

Invariant 14:

```text
Phase 4.4 never deletes Bronze.
```

---

# Definition of Done

Phase 4.4 is COMPLETE when:

* [ ] `src/lineage.rs` exists with real lineage responsibility.
* [ ] Lineage records are stored durably in MinIO.
* [ ] Lineage schema version V1 exists.
* [ ] Lineage IDs are deterministic.
* [ ] Event ID is not used as lineage identity.
* [ ] Source product ID is persisted.
* [ ] Source URI is persisted.
* [ ] Real source version is persisted when available.
* [ ] Bronze object key is persisted.
* [ ] Bronze object size is persisted.
* [ ] Bronze SHA256 is persisted.
* [ ] Product metadata is preserved.
* [ ] Processor version is persisted.
* [ ] Output-affecting processing policy is reproducible.
* [ ] Silver object key is persisted.
* [ ] Silver size is persisted.
* [ ] Silver SHA256 is persisted.
* [ ] Silver schema version is persisted.
* [ ] `LINEAGE_COMMITTED` is represented.
* [ ] Lineage commit requires a `COMPLETED` preprocessing checkpoint.
* [ ] Bronze lineage is verified before commit.
* [ ] Silver lineage is verified before commit.
* [ ] Existing identical lineage is reused idempotently.
* [ ] Existing conflicting lineage is rejected.
* [ ] Original `committed_at` is preserved on idempotent reuse.
* [ ] `bronze-eviction-v1` eligibility policy exists.
* [ ] Successful valid Silver products can become `EVICTABLE`.
* [ ] Missing source URI blocks eligibility.
* [ ] Missing Silver blocks eligibility.
* [ ] Incomplete preprocessing checkpoint blocks eligibility.
* [ ] Rejected products are not automatically eligible.
* [ ] Conflict products are not automatically eligible.
* [ ] TPF and LC eligibility remain independent.
* [ ] FFI eligibility remains independent.
* [ ] Gold is not required for V1 eligibility.
* [ ] Lineage is committed before JetStream ACK.
* [ ] Temporary lineage PUT failure prevents ACK.
* [ ] Temporary lineage failure does not downgrade `COMPLETED`.
* [ ] Redelivery retries lineage without repeating science processing.
* [ ] Crash-before-lineage recovery works.
* [ ] Crash-after-lineage-before-ACK recovery works.
* [ ] LC lineage integration test passes.
* [ ] TPF lineage integration test passes.
* [ ] FFI lineage integration test passes.
* [ ] Existing-lineage idempotency test passes.
* [ ] Lineage-conflict test passes.
* [ ] Mixed eligibility test passes.
* [ ] `contracts/data/lineage-v1.md` exists.
* [ ] `docs/LINEAGE.md` exists.
* [ ] `docs/CHECKPOINTS.md` explains lineage vs checkpoint.
* [ ] No Bronze object is deleted.
* [ ] No lifecycle deletion checkpoint is created prematurely.
* [ ] Repository is ready for Phase 4.5.

---

# Out of Scope

Do NOT implement in Phase 4.4:

* actual Bronze DeleteObject calls
* rolling 50 GiB window
* 45 GiB high watermark
* 30 GiB low watermark
* oldest-first eviction
* RAW_DELETED lifecycle state
* lifecycle deletion checkpoint
* Silver retention/deletion
* automatic rejected-raw deletion
* Gold feature engineering
* Gold lineage
* TOI/TCE enrichment
* Python ML
* model lineage
* prediction lineage
* dashboard storage controls

---

# Next

```text
Stage 4 — Recovery, Idempotency & Rolling Lifecycle

Phase 4.1  Preprocessor Checkpoint & Processing State        [DONE]

Phase 4.2  Cross-Service Idempotency & Reconciliation        [DONE]

Phase 4.3  Redelivery, Retry & Poison-Message Policy         [DONE]

Phase 4.4  Lineage Commit & Eviction Eligibility             [DONE]

Phase 4.5  Rolling Bronze Window & Safe Eviction
```
