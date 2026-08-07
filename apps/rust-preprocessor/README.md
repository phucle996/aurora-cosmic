# aurora-rust-preprocessor

`aurora-preprocessor` consumes `bronze-object-ready` events from NATS JetStream,
fetches raw FITS objects from MinIO Bronze, verifies object integrity and SHA-256 checksums,
decodes Light Curve, TPF, and FFI FITS files into typed in-memory representations,
performs scientific quality filtering and median normalization on Light Curves,
and materializes normalized Arrow/Parquet outputs into MinIO Silver.

---

## Phase 3.3 — Current Boundary

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
MinIO Bronze GET (Async stream) + SHA-256 verification
        |
        v
spawn_blocking
        |
        +--> FITS decode (CFITSIO)
        |
        +--> Light Curve Pipeline Preprocessing
                 |
                 +-- 1. Select PDCSAP_FLUX (or SAP_FLUX fallback)
                 +-- 2. Filter non-finite TIME/FLUX/FLUX_ERR values
                 +-- 3. Strict quality filtering (QUALITY == 0)
                 +-- 4. Time ascending sort & deterministic deduplication
                 +-- 5. Median normalization (baseline = 0.0)
                 +-- 6. Conservative outlier handling (optional, preserves transits)
                 |
                 v
        ProcessedLightCurve
```

**Implemented in Phase 3.3:**
- `pipeline::lightcurve::preprocess_lc`: pure CPU transformation
- Deterministic quality filtering (Strict mode `quality == 0`)
- Non-finite (`NaN` / `Inf`) value removal preserving row alignment
- Baseline median normalization (`normalized_flux = (flux / median) - 1.0`)
- Flux error normalization (`normalized_err = err / median`)
- Time-series sorting and deduplication preserving observation gaps
- Transit preservation (default configuration does NOT strip shallow dip signals)
- Tracking pipeline metadata (`processor_version = "lc-preprocess-v1"`, counts for input/output/quality/invalid)

**Not yet implemented in Phase 3.3:**
- TPF / FFI scientific preprocessing (Phase 3.4)
- Silver Parquet write (Phase 3.5)
- Detrending, phase folding, or transit search (Stage 5 Gold)

---

## Code Layout

```text
src/
├── main.rs         — Entrypoint (tiny)
├── app.rs          — NATS & MinIO StorageClient initialization, shutdown wiring
├── config.rs       — Configuration from environment (including LightCurveConfig)
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
├── pipeline/       — Scientific Preprocessing Pipelines (Phase 3.3+)
│   ├── mod.rs      — Re-exports ProcessedLightCurve & preprocess_lc
│   ├── lightcurve.rs — Pure CPU Light Curve quality filter & median normalization
│   └── image.rs    — TPF / FFI pipeline (UNUSED until Phase 3.4)
│
├── output/         — Silver materialization (UNUSED until Phase 3.5)
│   └── silver.rs
│
└── tests/          — Unit & integration tests
    ├── mod.rs
    ├── config_tests.rs
    ├── consumer_tests.rs
    ├── event_tests.rs
    ├── fits_tests.rs
    └── pipeline_lc_tests.rs
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
| `AURORA_LC_MIN_POINTS` | ❌ | `100` | Minimum points required for a valid Light Curve |
| `AURORA_LC_QUALITY_MODE` | ❌ | `strict` | Quality mode (`strict` = keep quality==0, `none`) |
| `AURORA_LC_ALLOW_SAP_FALLBACK` | ❌ | `false` | Fallback to SAP_FLUX if PDCSAP_FLUX is missing |
| `AURORA_LC_SIGMA_CLIP` | ❌ | — | Optional sigma clipping threshold (disabled by default) |

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
