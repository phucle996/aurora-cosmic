# Rust Inference Service

`aurora-inference` is the production inference worker for committed Gold
Parquet artifacts. It consumes `aurora.v1.inference.*.requested` jobs from
NATS JetStream, verifies the job/runtime/Gold SHA-256 contracts, executes the
qualified ONNX package with ONNX Runtime, and writes newline-delimited
`prediction-candidate-v1` or `prediction-anomaly-v1` records to MinIO.

## Runtime flow

```text
NATS inference job
      │
      ├─ verify event ↔ inference-job-v1 manifest
      ├─ fetch runtime package and verify manifest/checksums/parity fixture
      ├─ fetch Gold Parquet and verify content SHA + row count
      ├─ read feature_order, standardize with preprocessing.json
      ├─ execute one reusable ONNX Runtime session (bounded workers)
      ├─ write immutable prediction JSONL and a durable execution status record
      └─ confirm ACK only after the completed status is persisted
```

The runtime package is immutable and contains `model.onnx`,
`preprocessing.json`, `threshold.json`, `parity-fixture.json`, and
`manifest.json`. Parity validation executes the actual ONNX graph; fixture
outputs are expected values only and are never used as model outputs.

## Resource controls

`AURORA_INFERENCE_WORKERS` bounds both concurrent jobs and JetStream
`max_ack_pending`; a message is pulled only after a real execution slot becomes
available. `AURORA_INFERENCE_INTRA_THREADS` bounds ONNX intra-op threads. Gold
objects are rejected from their S3 metadata before download, streamed to a
temporary file with SHA-256 verification, then decoded in 1,024-row Parquet
batches. Prediction JSONL is spooled to disk before upload rather than held in
RAM. A runtime package is parity-qualified once per worker process for each
immutable manifest SHA; later jobs still verify the package manifest SHA and
persisted Rust qualification record, but do not create a second parity session.

Long jobs emit JetStream progress ACKs. Failed deliveries are recorded as
`retrying` with their actual attempt number, NAKed with a bounded delay, and
written to `inference/dead-letters/` after the final delivery. The mutable
execution record at `inference/status/<job-id>.json` is what the API uses for
`planned`, `running`, `retrying`, `failed`, and `completed` state; it is not
part of the immutable inference-job manifest.

The worker exposes `AURORA_INFERENCE_METRICS_ADDR` (default
`0.0.0.0:8084`) with `/metrics` for Prometheus and `/healthz` for container
health checks. The observer publishes seven bounded metric families: job
outcomes, processing duration, errors, in-flight jobs, queue depth, processed
rows, and last successful job timestamp. Runtime IDs and object keys are never
metric labels.

Inference defaults to `AURORA_ML_DEVICE=auto`: it uses the ONNX Runtime CUDA
execution provider when the provider library can be loaded and otherwise runs
the same immutable model package on the CPU provider. Set `cuda` to require GPU
execution or `cpu` to force the portable provider. Provider selection never
changes model inputs, thresholds, parity fixtures, or prediction identities.

## Source layout

```text
src/
├── application/    service lifecycle and JetStream worker orchestration
├── adapters/       MinIO and Gold Parquet I/O
├── domain/         job, model-runtime, and prediction contracts
├── runtime/        ONNX session, preprocessing, checksums, and parity
├── observer.rs     bounded Prometheus metrics and HTTP health endpoint
├── config.rs       environment-backed deployment configuration
├── logger.rs       structured logging setup
└── main.rs         process entrypoint
```

The dependency direction is intentional: domain contracts do not depend on
adapters; runtime owns numerical/model validation; application coordinates
the adapters and runtime.

## Tests

```bash
cargo test --manifest-path apps/rust-inference/Cargo.toml
cargo clippy --manifest-path apps/rust-inference/Cargo.toml --all-targets -- -D warnings
```
