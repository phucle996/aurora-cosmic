# aurora-rust-preprocessor

`aurora-preprocessor` consumes `bronze-object-ready` events from NATS JetStream,
fetches raw FITS objects from MinIO Bronze, verifies object integrity and SHA-256 checksums,
decodes Light Curve, TPF, and FFI FITS files into typed in-memory representations,
performs scientific quality filtering, median normalization, and statistics computation,
and materializes versioned Arrow/Parquet Silver artifacts into MinIO Silver.

---

## Phase 3.5 — Final Stage 3 Architecture & ACK Boundary

```text
NATS JetStream (AURORA_BRONZE)
        |
        v
aurora.v1.bronze.*.ready
        |
        v
Rust Consumer Runtime
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
        +--> 1. FITS decode (CFITSIO)
        |
        +--> 2. Scientific Preprocessing (LC / TPF / FFI)
        |
        +--> 3. Arrow RecordBatch & Parquet ZSTD Serialization
        |
        v
MinIO Silver PutObject (Async upload)
        |
        v
MinIO Silver StatObject & Size Verification
        |
        v
JetStream ACK (ACK ONLY AFTER durable Silver verification)
```

**Key Invariants (Phase 3.5):**
- **ACK Boundary**: JetStream message is ACKed **ONLY AFTER** the Silver artifact is uploaded and verified in MinIO.
- **Deterministic Keys**: Silver paths depend deterministically on `product_kind`, `sector`, `tic_id` / `camera`/`ccd`, `source_product_id`, and `processor_version`.
- **Processor Versioning**: `processor_version` is embedded in the Silver object key (e.g. `lc-preprocess-v1`), ensuring preprocessed outputs from different algorithms coexist safely.
- **Arrow/Parquet Formats**:
  - `silver-lightcurve-v1`: tabular cadences (`time`: Float64, `flux`: Float32, `flux_err`: Float32 nullable, `quality`: Int32)
  - `silver-target-pixel-v1`: cadence rows with flattened row-major pixel list (`flux`: List<Float32>, `rows`: Int32, `cols`: Int32)
  - `silver-ffi-v1`: compact image statistics (`width`, `height`, `finite_pixel_count`, `finite_pixel_fraction`, `median`, `mean`, `stddev`, `min`, `max`)

---

## Code Layout

```text
src/
├── main.rs         — Entrypoint
├── app.rs          — NATS & MinIO StorageClient initialization, shutdown wiring
├── config.rs       — Configuration from environment (CoreConfig, MinioConfig, NatsConfig, ConsumerConfig, LightCurveConfig, ImageConfig)
├── logger.rs       — Structured JSON logger
├── event.rs        — BronzeObjectReady + ProductKind typed structs
├── consumer.rs     — JetStream consumer, Semaphore, JoinSet, post-Silver ACK boundary
├── storage.rs      — MinIO client, stat_and_verify_size, fetch_to_temp, put_file_and_verify
│
├── fits/           — FITS decoding (CFITSIO wrapper)
│   ├── mod.rs      — DecodedProduct enum, DecodedSource struct, decode dispatch
│   ├── lightcurve.rs — RawLightCurve, decode_lc
│   └── image.rs    — RawTargetPixel, RawFfi, decode_tpf, decode_ffi
│
├── pipeline/       — Scientific Preprocessing Pipelines (Phase 3.3/3.4)
│   ├── mod.rs      — Re-exports LC & Image preprocessing types and functions
│   ├── lightcurve.rs — Pure CPU Light Curve quality filter & median normalization
│   └── image.rs    — TPF & FFI scientific preprocessing & stats
│
├── output/         — Silver Materialization (Phase 3.5)
│   ├── mod.rs      — Re-exports SilverArtifact & serialization functions
│   └── silver.rs   — Arrow schema definitions, Parquet ZSTD writer, deterministic key builders
│
└── tests/          — Unit & integration tests
    ├── mod.rs
    ├── config_tests.rs
    ├── consumer_tests.rs
    ├── event_tests.rs
    ├── fits_tests.rs
    ├── pipeline_lc_tests.rs
    ├── pipeline_image_tests.rs
    └── silver_tests.rs
```

---

## Data Contracts

Machine-readable data contracts are available under [`contracts/data/`](file:///home/phucle/Desktop/aurora-cosmic/contracts/data/):
- [`silver-lightcurve-v1.md`](file:///home/phucle/Desktop/aurora-cosmic/contracts/data/silver-lightcurve-v1.md)
- [`silver-target-pixel-v1.md`](file:///home/phucle/Desktop/aurora-cosmic/contracts/data/silver-target-pixel-v1.md)
- [`silver-ffi-v1.md`](file:///home/phucle/Desktop/aurora-cosmic/contracts/data/silver-ffi-v1.md)

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
| `AURORA_PREPROCESS_TMP_DIR` | ❌ | `/tmp/aurora-preprocessor` | Temp staging directory for FITS & Parquet files |
| `AURORA_LC_MIN_POINTS` | ❌ | `100` | Minimum points required for a valid Light Curve |
| `AURORA_LC_QUALITY_MODE` | ❌ | `strict` | Quality mode (`strict` = keep quality==0, `none`) |
| `AURORA_LC_ALLOW_SAP_FALLBACK` | ❌ | `false` | Fallback to SAP_FLUX if PDCSAP_FLUX is missing |
| `AURORA_LC_SIGMA_CLIP` | ❌ | — | Optional sigma clipping threshold (disabled by default) |
| `AURORA_TPF_QUALITY_MODE` | ❌ | `strict` | TPF quality mode (`strict` = keep quality==0, `none`) |
| `AURORA_TPF_NORMALIZATION` | ❌ | `temporal-median` | TPF normalization strategy |
| `AURORA_FFI_NORMALIZATION` | ❌ | `median` | FFI normalization strategy |
| `AURORA_FFI_CUTOUT_SIZE` | ❌ | `32` | FFI cutout side dimension in pixels |

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
