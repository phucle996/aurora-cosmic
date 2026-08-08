# Go API Service

`aurora-api` provides read-only HTTP endpoints querying analytical Targets,
Light Curves, Candidates, Anomalies, and System Health.

## Package Layout

* `cmd/aurora-api/` — Entrypoint
* `internal/app/` — Application runner and server router initialization
* `internal/http/` — HTTP transport, validation, pagination, and readiness handlers
* `internal/store/` — ClickHouse/MinIO adapters and query interfaces

## Runtime contract

* `/healthz` is process liveness and does not require dependencies.
* `/readyz` checks MinIO and ClickHouse and returns `503` until both are ready.
* Candidate and anomaly queries require an explicit `snapshot_id` so cumulative
  Gold snapshots cannot be double-counted.
* Collection endpoints accept `limit` (1–1000) and `offset` (0–10000000).
* `tic_id` is required for lightcurve queries; the API never silently chooses a
  synthetic/default target.

Examples:

```text
GET /api/v1/candidates?snapshot_id=gold-v1-a79dace56cdc&sector=42&limit=100&offset=0
GET /api/v1/anomalies?snapshot_id=gold-v1-a79dace56cdc&limit=100
GET /api/v1/targets?sector=42&limit=100
GET /api/v1/lightcurves?tic_id=882271&limit=1000&offset=0
```
