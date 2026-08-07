# Go Ingester Service

`aurora-ingester` is responsible for querying NASA MAST, discovering TESS FITS products, streaming raw FITS directly into MinIO Bronze, and publishing lightweight ingestion events via NATS JetStream.

## Package Layout

* `cmd/aurora-ingester/` — Entrypoint wiring dependencies
* `internal/app/` — Application runner and lifecycle
* `internal/mast/` — MAST API discovery and product client
* `internal/ingest/` — FITS streaming pipeline and checksum verification
* `internal/storage/` — MinIO object storage client
* `internal/events/` — NATS JetStream event publisher
* `internal/checkpoint/` — Ingestion progress state store
