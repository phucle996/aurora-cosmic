# AURORA Enrichment Service

`aurora-enrichment` is the CPU-only Silver-to-Gold enrichment service. It consumes
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
`checkpoints/enrichment/pending/`; reusable TPF contexts are stored under
`checkpoints/enrichment/modalities/`. A batch is eligible only when every LC
has its TPF. The worker then retrieves TIC and TOI evidence for that exact batch,
normalizes it, stores immutable MinIO snapshots, validates coverage, and passes
those snapshot IDs to the materializer. A provider failure leaves the batch
checkpointed with `WAITING_FOR_CATALOG_SYNC`; it never falls back to stale,
global, or fabricated catalog data.

## Operator control

The dashboard controls stream, backlog, drain and pause through the durable
`control/enrichment.json` record. Stream mode begins only after the first
Silver event and flushes on the configured record or idle-time limit. Runtime
state is written to `control/enrichment/status.json`; committed run and batch
history is indexed in ClickHouse.

## Benchmarks & Heap Allocation Profiling

The service includes an in-memory benchmark and heap allocation profiling suite under `benches/`:

```bash
# Run all benchmark scenarios and print allocated heap + RSS metrics:
uv run python -m benches.runner

# Run specific scenario (wave, tpf, concurrency, chaos, throughput):
uv run python -m benches.runner --scenario tpf

# Run automated CI regression tests:
uv run pytest tests/test_benchmarks.py -v
```
