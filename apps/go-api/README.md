# Go API Service

`aurora-api` provides HTTP endpoints querying analytical Targets, Light Curves,
Candidates, Anomalies, Model Runtime Registry, Inference Jobs, and System
Health. Model execution remains isolated in the GPU-only Rust inference worker.

## Package Layout

```text
cmd/aurora-api/              process entrypoint
infra/                       ClickHouse, MinIO, NATS, Prometheus clients
internal/app/                composition root, module DI wiring, and Gin route registration
internal/domain/             framework-free entities and repository/service ports
internal/http/dto/           API request DTO structs
internal/http/handler/       HTTP input parsing, service calls, and inline gin.H responses
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
* Candidate and anomaly queries require an explicit `snapshot_id` so cumulative
  Gold snapshots cannot be double-counted.
* `/api/v1/models` only exposes committed runtime manifests whose ONNX,
  preprocessing, threshold, and parity fixture checksums match MinIO.
* Inference retry publishes an existing immutable job manifest to NATS; the API
  never loads a model or performs CPU inference itself.
* Collection endpoints accept `limit` (1–1000) and `offset` (0–10000000).
* `tic_id` is required for lightcurve queries; the API never silently chooses a
  synthetic/default target.

Examples:

```text
GET /api/v1/candidates?snapshot_id=gold-v1-a79dace56cdc&sector=42&limit=100&offset=0
GET /api/v1/anomalies?snapshot_id=gold-v1-a79dace56cdc&limit=100
GET /api/v1/targets?sector=42&limit=100
GET /api/v1/lightcurves?tic_id=882271&limit=1000&offset=0
GET /api/v1/models?task=anomaly
GET /api/v1/inference/jobs?model_id=model-anom-v1-dde689ef5383
POST /api/v1/inference/jobs/inference-job-v1-<id>/retry
```
