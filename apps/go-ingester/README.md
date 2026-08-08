# Go Ingester Service

`aurora-ingester` is responsible for querying NASA MAST, discovering TESS FITS products, creating deterministic ingestion manifests, streaming raw FITS directly into MinIO Bronze, publishing lightweight ingestion events via NATS JetStream, and persisting restart-safe checkpoints.

## Package Layout

* `cmd/aurora-ingester/` — Entrypoint, subcommand routing (`plan`, `ingest`, `status`)
* `internal/app/` — Application runner and lifecycle
* `internal/config/` — Environment-based configuration
* `pkg/logger/` — Structured JSON logger (stdlib slog)
* `internal/mast/` — MAST API client, product discovery, classification, streaming download
* `internal/manifest/` — Product selection, TPF/LC pairing, manifest write/read
* `internal/ingest/` — Streaming ingestion pipeline (SHA256, worker pool, verification)
* `internal/storage/` — MinIO storage client, deterministic Bronze Object Key builder
* `internal/events/` — NATS JetStream event publisher (Phase 2.4)
* `internal/checkpoint/` — Persistent ingestion progress store and recovery manager (Phase 2.5)

## 1. Planning / Manifest

Query NASA MAST and create a versioned JSON ingestion manifest without downloading binaries:

```bash
go run ./cmd/aurora-ingester plan \
    --sector 42 \
    --limit 100 \
    --output manifest.json
```

## 2. Streaming Ingestion & Resume

Stream selected TESS FITS products directly from MAST into MinIO Bronze with automatic checkpointing:

```bash
go run ./cmd/aurora-ingester ingest \
    --manifest manifest.json \
    --concurrency 8
```

Restart / Resume existing run:

```bash
go run ./cmd/aurora-ingester ingest \
    --manifest manifest.json \
    --resume
```

Force fresh run:

```bash
go run ./cmd/aurora-ingester ingest \
    --manifest manifest.json \
    --fresh
```

Dry-run mode (prints planned MinIO object paths and NATS subjects with zero write side effects):

```bash
go run ./cmd/aurora-ingester ingest \
    --manifest manifest.json \
    --dry-run
```

## 3. Ingestion Status

Display progress status of the current/latest ingestion run:

```bash
go run ./cmd/aurora-ingester status
```

## Bronze Object Layout

FITS files are stored deterministically in MinIO Bronze bucket (`MINIO_BUCKET=aurora`):

* **Target Pixel**: `bronze/tess/target-pixel/sector=0042/tic=123456789/<filename>_tp.fits`
* **Light Curve**: `bronze/tess/lightcurve/sector=0042/tic=123456789/<filename>_lc.fits`
* **FFI**: `bronze/tess/ffi/sector=0042/camera=1/ccd=3/<filename>_ffic.fits`
* **Checkpoints**: `checkpoints/ingestion/runs/<run-id>.json` & `checkpoints/ingestion/current.json`

## Running tests

```bash
go test ./...
```

## Throughput tuning

The ingester is network-bound: increase concurrency gradually while watching
MAST 429 responses, MinIO latency, and host NIC utilization. Start at 8 and
test 16 only when the upstream remains healthy. FITS downloads use a bounded
queue and an HTTP keep-alive pool; large streams are not cut off by a total
30-second client timeout.

Checkpoint state is flushed every 5 seconds by default instead of writing two
MinIO objects after every product. Set `AURORA_CHECKPOINT_FLUSH_INTERVAL` to a
larger duration for maximum throughput, accepting a larger recovery window.
