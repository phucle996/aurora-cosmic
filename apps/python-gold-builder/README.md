# AURORA Gold Builder

`aurora-gold-builder` is the CPU-only Stage 5 service between the Rust
preprocessor and the GPU ML worker. It consumes verified Silver events, reads
Silver Parquet artifacts from MinIO, derives deterministic light-curve Gold
features, and commits an immutable Gold snapshot.

The first release deliberately builds candidate snapshots from Silver
light-curves. TPF/FFI evidence and catalog snapshots remain extension points;
the manifest and event contracts already preserve the Silver lineage needed to
add them without changing the Bronze-to-Silver service.

## Commands

```bash
# Build a snapshot from a JSON array of Silver events
python -m aurora_gold_builder build --events-file events.json --set-current

# Run the durable Silver-event consumer
python -m aurora_gold_builder worker
```

The worker persists pending events under
`checkpoints/gold-builder/pending/` before acknowledging NATS. It flushes a
snapshot when the configured batch size is reached or the flush window elapses.
Gold artifacts are written under `gold/snapshots/<snapshot-id>/` and the
current pointer is `gold/current/CANDIDATE.json`.
