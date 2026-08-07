# Go Ingester Service

`aurora-ingester` is responsible for querying NASA MAST, discovering TESS FITS products, creating deterministic ingestion manifests, streaming raw FITS into MinIO Bronze, and publishing lightweight ingestion events via NATS JetStream.

## Package Layout

* `cmd/aurora-ingester/` — Entrypoint, subcommand routing
* `internal/app/` — Application runner and lifecycle
* `internal/config/` — Environment-based configuration
* `internal/logger/` — Structured JSON logger (stdlib slog)
* `internal/mast/` — MAST API client, product discovery, classification
* `internal/manifest/` — Product selection, TPF/LC pairing, manifest write/read
* `internal/ingest/` — FITS streaming pipeline (Phase 2.3)
* `internal/storage/` — MinIO object storage client
* `internal/events/` — NATS JetStream event publisher
* `internal/checkpoint/` — Ingestion progress state store

## Discovery

Query NASA MAST for available TESS observations and products:

```bash
go run ./cmd/aurora-ingester plan \
    --sector 42 \
    --limit 100 \
    --output manifest.json
```

## Planning / Manifest

`plan` performs discovery + selection + pairing and writes a versioned JSON manifest. No FITS files are downloaded; no MinIO objects are written; no NATS events are published.

Options:

| Flag | Default | Description |
|---|---|---|
| `--sector` | `0` (all) | Filter by TESS sector |
| `--limit` | `100` | Max observations to discover |
| `--max-bytes` | `0` (unlimited) | Optional byte budget |
| `--max-ffi` | `0` (unlimited) | Max FFI products |
| `--output` | `manifest.json` | Output path |

Selection policy is further controlled by environment variables (`AURORA_INCLUDE_TPF`, `AURORA_INCLUDE_LIGHTCURVE`, `AURORA_INCLUDE_FFI`, `AURORA_REQUIRE_TPF_LC_PAIR`).

## Running tests

```bash
go test ./tests/...
```
