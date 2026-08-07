# aurora-rust-preprocessor

`aurora-preprocessor` consumes `bronze-object-ready` events from NATS JetStream,
fetches raw FITS objects from MinIO Bronze, verifies object integrity and SHA-256 checksums,
decodes Light Curve, TPF, and FFI FITS files into typed in-memory representations,
and materializes normalized Arrow/Parquet outputs into MinIO Silver.

---

## Phase 3.2 — Current Boundary

```text
NATS JetStream (AURORA_BRONZE)
        |
        v
aurora.v1.bronze.*.ready
        |
        v
Rust Consumer
        |
        v
Semaphore(N) — bounded Tokio concurrency
        |
        v
MinIO Bronze GET (Async stream)
        |
        v
Stream & Hash SHA-256 + Byte count
        |
        v
Verify size & SHA-256 checksum
        |
        v
spawn_blocking
        |
        v
fits::decode (CFITSIO)
        |
  +-----+-----+
  |     |     |
  v     v     v
 RawLC RawTPF RawFFI
```

**Implemented in Phase 3.2:**
- MinIO Bronze object stat and size verification
- Streaming MinIO GET with on-the-fly SHA-256 checksum & byte count computation
- Temporary local file staging with auto-deletion on scope exit
- `spawn_blocking` FITS decoding using `fitsio` (CFITSIO)
- Decoded typed structures: `RawLightCurve`, `RawTargetPixel`, `RawFfi`
- FITS header vs event identity validation (TIC ID, Sector)

**Not yet implemented in Phase 3.2:**
- Light Curve scientific preprocessing (Phase 3.3)
- TPF / FFI scientific preprocessing (Phase 3.4)
- Silver Parquet write (Phase 3.5)

---

## Code Layout

```text
src/
├── main.rs         — Entrypoint (tiny)
├── app.rs          — NATS & MinIO StorageClient initialization, shutdown wiring
├── config.rs       — Configuration from environment
├── logger.rs       — Structured JSON logger
├── event.rs        — BronzeObjectReady + ProductKind typed structs
├── consumer.rs     — JetStream consumer, Semaphore, JoinSet, ACK/NAK/TERM
├── storage.rs      — MinIO client, stat_and_verify_size, fetch_to_temp + SHA-256
│
├── fits/           — FITS decoding (Phase 3.2)
│   ├── mod.rs      — DecodedProduct enum, DecodedSource struct, decode dispatch
│   ├── lightcurve.rs — RawLightCurve, decode_lc
│   └── image.rs    — RawTargetPixel, RawFfi, decode_tpf, decode_ffi
│
├── pipeline/       — Preprocessing pipelines (UNUSED until Phase 3.3+)
├── output/         — Silver materialization (UNUSED until Phase 3.5)
│   └── silver.rs
│
└── tests/          — Unit & integration tests
    ├── mod.rs
    ├── config_tests.rs
    ├── consumer_tests.rs
    ├── event_tests.rs
    └── fits_tests.rs
```

---

## Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `AURORA_ENV` | ✅ | — | Runtime environment (`development`, `production`) |
| `AURORA_LOG_LEVEL` | ✅ | — | Log level (`info`, `debug`, `warn`) |
| `NATS_URL` | ✅ | — | NATS server URL |
| `MINIO_ENDPOINT` | ✅ | — | MinIO API endpoint |
| `MINIO_ACCESS_KEY` | ✅ | — | MinIO access key |
| `MINIO_SECRET_KEY` | ✅ | — | MinIO secret key |
| `MINIO_BUCKET` | ✅ | — | MinIO bucket name (`aurora`) |
| `AURORA_PREPROCESS_WORKERS` | ✅ | — | Max concurrent processing jobs (must be ≥ 1) |
| `AURORA_PREPROCESS_DURABLE` | ❌ | `aurora-rust-preprocessor` | JetStream durable consumer name |
| `AURORA_PREPROCESS_STREAM` | ❌ | `AURORA_BRONZE` | JetStream stream name |
| `AURORA_PREPROCESS_ACK_WAIT` | ❌ | `30s` | JetStream ACK wait duration |
| `AURORA_PREPROCESS_SHUTDOWN_TIMEOUT` | ❌ | `30` | Drain timeout in seconds on shutdown |
| `AURORA_PREPROCESS_TMP_DIR` | ❌ | `/tmp/aurora-preprocessor` | Temp staging directory for FITS files |

---

## System Requirements

Building `aurora-preprocessor` requires `cfitsio` (CFITSIO C library):

- **Alpine Linux / Docker**: `apk add cfitsio-dev pkgconfig musl-dev`
- **Ubuntu / Debian**: `apt-get install libcfitsio-dev pkg-config`
- **macOS**: `brew install cfitsio pkg-config`

---

## Running Locally

```bash
cp .env.example .env
cargo run
```

## Testing

```bash
cargo test
```
