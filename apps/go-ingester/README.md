# Go Ingester Service

`aurora-ingester` is responsible for querying NASA MAST, discovering TESS FITS products, creating deterministic ingestion manifests, streaming raw FITS directly into MinIO Bronze, and publishing lightweight ingestion events via NATS JetStream.

## Package Layout

* `cmd/aurora-ingester/` — Entrypoint, subcommand routing (`plan`, `ingest`)
* `internal/app/` — Application runner and lifecycle
* `internal/config/` — Environment-based configuration
* `internal/logger/` — Structured JSON logger (stdlib slog)
* `internal/mast/` — MAST API client, product discovery, classification, streaming download
* `internal/manifest/` — Product selection, TPF/LC pairing, manifest write/read
* `internal/ingest/` — Streaming ingestion pipeline (SHA256, worker pool, verification)
* `internal/storage/` — MinIO storage client, deterministic Bronze Object Key builder
* `internal/events/` — NATS JetStream event publisher (Phase 2.4)
* `internal/checkpoint/` — Ingestion progress state store (Phase 2.5)

## 1. Planning / Manifest

Query NASA MAST and create a versioned JSON ingestion manifest without downloading binaries:

```bash
go run ./cmd/aurora-ingester plan \
    --sector 42 \
    --limit 100 \
    --output manifest.json
```

## 2. Streaming Ingestion

Stream selected TESS FITS products directly from MAST into MinIO Bronze:

```bash
go run ./cmd/aurora-ingester ingest \
    --manifest manifest.json \
    --concurrency 4
```

Dry-run mode (prints planned MinIO object paths with zero write side effects):

```bash
go run ./cmd/aurora-ingester ingest \
    --manifest manifest.json \
    --dry-run
```

## Bronze Object Layout

FITS files are stored deterministically in MinIO Bronze bucket (`MINIO_BUCKET=aurora`):

* **Target Pixel**: `bronze/tess/target-pixel/sector=0042/tic=123456789/<filename>_tp.fits`
* **Light Curve**: `bronze/tess/lightcurve/sector=0042/tic=123456789/<filename>_lc.fits`
* **FFI**: `bronze/tess/ffi/sector=0042/camera=1/ccd=3/<filename>_ffic.fits`

## Running tests

```bash
go test ./...
```
