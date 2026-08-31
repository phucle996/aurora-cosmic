# Go Ingester Service

`aurora-ingester` is responsible for querying NASA MAST, discovering TESS FITS products, creating deterministic ingestion manifests, streaming raw FITS directly into MinIO Bronze, publishing lightweight ingestion events via NATS JetStream, and persisting restart-safe checkpoints.

The long-running service starts idle. It only creates an ingestion run after the
dashboard calls `POST /api/v1/ingest/jobs`; startup/restart never discovers or
downloads data automatically. The dashboard does not send a product-count
limit: discovery continues until the configured Bronze run budget is reached.
The binary has one responsibility: run the control-plane service. Planning,
starting, draining, and historical inspection are all initiated through the
API and dashboard; there is no parallel CLI execution path.

## Package Layout

* `cmd/` — Single service entrypoint (`main.go`)
* `internal/app/` — Process wiring and graceful service lifecycle
* `internal/control/` — HTTP transport, control contract, and single-flight job lifecycle
* `internal/config/` — Environment-based configuration
* `internal/observer/` — Bounded Prometheus metrics and `/healthz` endpoint
* `pkg/logger/` — Structured JSON logger (stdlib slog)
* `infra/mast/` — MAST API client, product discovery, classification, streaming download
* `internal/pipeline/plan/` — Research-ready product selection and manifest read/write
* `internal/pipeline/ingest/` — Manifest resolution, capacity safety, checkpoints, and bounded FITS streaming
* `infra/storage/` — MinIO adapter and deterministic Bronze object storage
* `infra/events/` — NATS JetStream publisher
* `internal/pipeline/checkpoint/` — Persistent ingestion progress and recovery

## Control Plane & Metrics

Ingestion progress and storage contents are available in the dashboard at
`/ingest`; the service no longer maintains a terminal progress command.

Each run is planned by `POST /api/v1/ingest/jobs` and then executed by the
long-running service. A plan contains only complete TPF + light-curve pairs,
which are the full observational contract required by Candidate Gold.

The service exposes a small, low-cardinality observer surface on
`AURORA_METRICS_ADDR` (default `:8081`):

* `/healthz` — process health
* `/metrics` — terminal product counts, product duration, errors, in-flight
  workers, queue depth, processed bytes, and last successful product timestamp

The observer never emits product IDs, object keys, or source URLs as labels.
Prometheus scrapes the systemd service at its configured metrics address.

## Bronze Object Layout

FITS files are stored deterministically in MinIO Bronze bucket (`MINIO_BUCKET=aurora`):

* **Target Pixel**: `bronze/tess/target-pixel/sector=0042/tic=123456789/<filename>_tp.fits`
* **Light Curve**: `bronze/tess/lightcurve/sector=0042/tic=123456789/<filename>_lc.fits`
* **Checkpoints**: `checkpoints/ingestion/runs/<run-id>.json` & `checkpoints/ingestion/current.json`

Bronze is managed as rolling target-product waves: ingestion fills to the
50 GiB active-wave watermark, waits for committed Silver lineage to become
evictable, cleans back to 10 GiB, and resumes. The hard safety ceiling remains
100 GiB.

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
