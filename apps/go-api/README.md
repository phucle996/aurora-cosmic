# Go API Service

`aurora-api` provides HTTP endpoints querying analytical Targets, Light Curves,
Candidates, Anomalies, Model Runtime Registry, Inference Jobs, and System
Health. Model execution remains isolated in the GPU-only Rust inference worker.

## Package Layout

```text
cmd/aurora-api/              process entrypoint
infra/                       ClickHouse, MinIO, NATS, Prometheus clients
internal/observer/           Dedicated Prometheus observer on AURORA_API_METRICS_ADDR
internal/app/                composition root, module DI wiring, and Gin route registration
internal/domain/             framework-free entities and repository/service ports
internal/transport/http/     HTTP transport (DTOs, handlers, middlewares)
internal/transport/stream/   Event/Stream transport (NATS consumer & subscriber)
internal/repository/         ClickHouse queries and raw MinIO object adapter
internal/service/            business workflows and MinIO model/inference logic
internal/taxonomy/           stable application errors
```

The dependency direction is strict:

```text
route → handler → service → domain ports → repository → infra client
```

Handlers do not query ClickHouse or MinIO directly. Services own workflow
decisions such as runtime integrity, champion selection, inference retry event
creation, and monitoring aggregation. `infra/` contains only external client
connections and low-level transport operations.

## Runtime contract

* `/healthz` is process liveness and does not require dependencies.
* `/readyz` checks MinIO and ClickHouse and returns `503` until both are ready.
* `/metrics` is served on the dedicated observer listener (default `:8086`),
  while the public API listener remains on `AURORA_API_PORT`.
* Candidate and anomaly queries require an explicit `snapshot_id` so cumulative
  Gold snapshots cannot be double-counted.
* Anomaly queries return threshold-crossing predictions by default. Pass
  `only_flagged=false` when an audit view needs every scored row.
* Target discovery supports TIC/Sector, Tmag, effective-temperature, RA/Dec,
  pipeline-state and data-availability filters. Target rows are keyed by
  `(tic_id, sector)` and include lightcurve coverage plus latest candidate and
  anomaly summaries derived from ClickHouse query indexes.
* `/api/v1/models` only exposes committed runtime manifests whose ONNX,
  preprocessing, threshold, and parity fixture checksums match MinIO.
* Inference retry publishes an existing immutable job manifest to NATS; the API
  never loads a model or performs CPU inference itself.
* `/api/v1/monitoring?tab=<component>&range=1h&step=60` returns one selected
  component and generic metric series (`key`, `name`, `unit`, `kind`, `points`).
  The `tab` can be omitted for the legacy all-components response.
* `/api/v1/preprocessing/graph` projects the latest five minutes of Rust
  preprocessor Prometheus telemetry onto the Bronze → Silver lineage canvas.
  It returns `not_observed` when no samples exist, and otherwise derives
  `running`, `completed`, `retry`, or `failed` from bounded worker, queue,
  throughput, error, and last-success metrics. The observation scope is
  `preprocessor_service`; per-TIC hop state requires lineage/run telemetry.
* `/api/v1/ingest/status` reads the durable ingestion checkpoint and enriches
  it with bounded ingester Prometheus rates. `/api/v1/storage?prefix=bronze/&page=1&limit=50`
  returns a paginated MinIO object view with `total_bytes` for the selected
  prefix. While discovery is still before the first checkpoint, the API keeps
  the live control-job state in memory and hydrates it from the ingester
  control endpoint after an API restart, so a browser refresh never falls back
  to an older completed run. Status responses expose the latest 100 products
  by default; use `products_limit=0` only for a full checkpoint dump.
* `GET /api/v1/events?workflow=preprocessing` is a long-lived SSE invalidation
  stream. Start/stop commands publish workflow events so dashboards can
  refetch authoritative status immediately; polling remains the fallback.
* `POST /api/v1/preprocessing/jobs` publishes an asynchronous preprocessing
  start command to NATS. `mode=stream` follows new Bronze events; `mode=batch`
  drains retained Bronze events. Preprocessing owns a separate checkpoint
  namespace under `checkpoints/preprocessing/`.
* `POST /api/v1/preprocessing/jobs/:job_id/stop` cancels the active worker and
  records a durable `CANCELED` run checkpoint. The stop state is kept in API
  memory while the worker drains, so refreshes do not re-enable a stale start.
* `GET /api/v1/gold/control` returns the durable Gold Builder desired mode and
  worker-authored runtime state. `POST /api/v1/gold/control/start` accepts
  `mode=stream|batch` and an idle window of 60–900 seconds; `POST
  /api/v1/gold/control/stop` requests a safe pause. The API writes control to
  MinIO, so operator intent survives API and worker restarts.
* Collection endpoints accept `limit` (1–1000) and `offset` (0–10000000).
* `tic_id` is required for lightcurve queries; the API never silently chooses a
  synthetic/default target.

Examples:

```text
GET /api/v1/candidates?snapshot_id=gold-v1-a79dace56cdc&sector=42&limit=100&offset=0
GET /api/v1/candidates/prediction-v1?snapshot_id=gold-v1-a79dace56cdc
GET /api/v1/anomalies?snapshot_id=gold-v1-a79dace56cdc&only_flagged=true&limit=100
GET /api/v1/targets?sector=42&tmag_min=8&tmag_max=14&teff_min=3000&teff_max=7000&sort=tmag_asc&limit=100
GET /api/v1/targets/882271?sector=42
GET /api/v1/lightcurves?tic_id=882271&sector=42&limit=1000&offset=0
GET /api/v1/models?task=anomaly
GET /api/v1/inference/jobs?model_id=model-anom-v1-dde689ef5383
GET /api/v1/preprocessing/graph
GET /api/v1/gold/control
GET /api/v1/ingest/status
GET /api/v1/storage?prefix=bronze/&page=1&limit=50
GET /api/v1/events?workflow=preprocessing
POST /api/v1/inference/jobs/inference-job-v1-<id>/retry
```

The candidate-detail response contains three deliberately separate outputs:

- `candidate.candidate_score`: ML transit-vetting rank, not habitability.
- `planet_physics`: nullable deterministic estimates such as radius, semi-major
  axis, incident flux, equilibrium temperature, and habitable-zone class.
- `habitability.physics_score`: explainable 0–100 follow-up priority with
  component reasons and input confidence. `habitability.ml_score` remains null
  with `ml_status=not_evaluated` until a separately trained and validated
  habitability model is registered.

The formula and release contracts are documented in
`contracts/data/planet-physics-v1.md` and
`contracts/data/habitability-assessment-v1.md`.
