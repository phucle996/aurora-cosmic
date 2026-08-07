# Rust Preprocessor Service

`aurora-preprocessor` consumes NATS ingestion events, reads raw FITS objects from MinIO Bronze, processes Light Curves & TPF images in parallel using bounded Tokio tasks, and materializes normalized Parquet outputs into MinIO Silver.

## Code Layout

* `src/main.rs` — Entrypoint
* `src/app.rs` — Application initialization & concurrency runtime
* `src/consumer.rs` — NATS JetStream consumer worker
* `src/storage.rs` — MinIO object storage reader/writer
* `src/checkpoint.rs` — Preprocessing state checkpoint store
* `src/fits/` — FITS header, Binary Table, and Image parsing modules
* `src/pipeline/` — Time-series detrending and TPF image calibration pipelines
* `src/output/` — Parquet materialization (Silver & Gold)
* `benches/` — Preprocessing performance benchmarks
