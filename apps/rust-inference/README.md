# Rust Inference Service

`aurora-inference` loads ONNX models from MinIO, listens for model promotion events, serves real-time exoplanet candidate & anomaly predictions, and generates evidence feature attributions.

## Code Layout

* `src/main.rs` — Entrypoint
* `src/app.rs` — Application initialization & event loop
* `src/model.rs` — Model definition and version metadata
* `src/runtime.rs` — ONNX Runtime session & execution engine
* `src/prediction.rs` — Inference prediction pipeline
* `src/evidence.rs` — Feature attribution & decision evidence generator
* `src/nats.rs` — NATS subscriber for model promotion events
