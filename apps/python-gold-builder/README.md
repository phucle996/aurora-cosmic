# AURORA Gold Builder

`aurora-gold-builder` is the CPU-only Silver-to-Gold service. It consumes
checksum-verified Silver events, pairs each light curve with its exact target
pixel file, synchronizes only the needed TIC/TOI rows, pins them as immutable
snapshots, and commits an immutable Candidate Gold snapshot.

The runtime contract is intentionally narrow:

`Silver LIGHT_CURVE + Silver TARGET_PIXEL -> scoped TIC/TOI snapshots -> Candidate Gold`

FFI and anomaly datasets are not part of this pipeline. TPF transit-deficit,
centroid and pixel-variability evidence is folded directly into the canonical
candidate row, so a second enrichment pass is unnecessary. Every manifest uses
the `research-ready-target-pair-v4` completeness policy and lists only the
`candidate` dataset. `gold/current/CANDIDATE.json` is the sole current pointer.

## Durable readiness

The worker reads ingestion checkpoints to identify the exact TPF source planned
for each LC. Pending LC events are stored under
`checkpoints/gold-builder/pending/`; reusable TPF contexts are stored under
`checkpoints/gold-builder/modalities/`. A batch is eligible only when every LC
has its TPF. The worker then retrieves TIC and TOI evidence for that exact batch,
normalizes it, stores immutable MinIO snapshots, validates coverage, and passes
those snapshot IDs to the materializer. A provider failure leaves the batch
checkpointed with `WAITING_FOR_CATALOG_SYNC`; it never falls back to stale,
global, or fabricated catalog data.

## Operator control

The dashboard controls stream, backlog, drain and pause through the durable
`control/gold-builder.json` record. Stream mode begins only after the first
Silver event and flushes on the configured record or idle-time limit. Runtime
state is written to `control/gold-builder/status.json`; committed run and batch
history is indexed in ClickHouse.
