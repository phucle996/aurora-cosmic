# Go API Service

`aurora-api` provides HTTP/gRPC endpoints querying Targets, Light Curves, Candidates, Anomalies, Model Registry metadata, and System Health.

## Package Layout

* `cmd/aurora-api/` — Entrypoint
* `internal/app/` — Application runner and server router initialization
* `internal/http/` — HTTP Handlers (`targets`, `candidates`, `anomalies`, `system`)
* `internal/store/` — MinIO and ClickHouse query stores
