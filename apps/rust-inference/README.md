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
      └─ write predictions/<task>/<snapshot>/<job>/part-00000.jsonl, then ACK
```

The runtime package is immutable and contains `model.onnx`,
`preprocessing.json`, `threshold.json`, `parity-fixture.json`, and
`manifest.json`. Parity validation executes the actual ONNX graph; fixture
outputs are expected values only and are never used as model outputs.

## Resource controls

`AURORA_INFERENCE_WORKERS` bounds concurrent jobs and
`AURORA_INFERENCE_INTRA_THREADS` bounds ONNX intra-op threads. Gold objects are
rejected above `AURORA_INFERENCE_MAX_GOLD_BYTES` before Parquet decoding.

The worker exposes `AURORA_INFERENCE_METRICS_ADDR` (default
`0.0.0.0:8084`) with `/metrics` for Prometheus and `/healthz` for container
health checks. The observer publishes seven bounded metric families: job
outcomes, processing duration, errors, in-flight jobs, queue depth, processed
rows, and last successful job timestamp. Runtime IDs and object keys are never
metric labels.

Inference is GPU-only: the image includes the ONNX Runtime CUDA execution
provider, Compose exposes the NVIDIA device, and startup/session creation fails
if CUDA cannot be registered. Training is also GPU-only in the Python ML
worker; CPU fallback is disabled for both model paths.

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
