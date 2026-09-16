# AURORA Platform Configuration Specification

This document details the environment configuration model, per-subproject environment files, internal vs host endpoints, secret policies, and device selection.

## 1. Environment-Driven Configuration Model

All platform and service configurations are strictly managed via environment variables defined per sub-project (`apps/<sub-project>/.env.example`). There are no shared YAML or centralized configuration files.

## 2. Docker Internal vs. Host Endpoints

| Service | Container Internal Endpoint | Host Development Endpoint |
| :--- | :--- | :--- |
| **MinIO API** | `http://minio:9000` | `http://localhost:9000` |
| **MinIO Console** | `http://minio:9001` | `http://localhost:9001` |
| **NATS Client** | `nats://nats:4222` | `nats://localhost:4222` |
| **NATS Monitor** | `http://nats:8222` | `http://localhost:8222` |
| **Go API** | `http://go-api:8080` | `http://localhost:8080` |
| **Dashboard** | `http://dashboard:8501` | `http://localhost:8501` |
| **ClickHouse HTTP** | `http://clickhouse:8123` | `http://localhost:8123` |
| **Prometheus** | `http://prometheus:9090` | `http://localhost:9090` |
| **Grafana (optional)** | `http://grafana:3000` | `http://localhost:3000` |

### Subsystem Telemetry & Metrics Scrape Endpoints

| Subsystem | Port | Endpoint | Purpose |
| :--- | :--- | :--- | :--- |
| **Go Ingester** | `8081` | `http://go-ingester:8081/metrics` | Ingestion throughput, rolling storage quota, checkpoints |
| **Go Ingester (Debug)**| `8087` | `http://go-ingester:8087/debug/pprof` | Profiling and memory diagnostics |
| **Rust Preprocessor** | `8082` | `http://rust-preprocessor:8082/metrics`| Rayon/Tokio concurrency, FITS parse latencies |
| **Python ML Worker** | `8083` | `http://python-ml-worker:8083/metrics` | PyTorch training/eval loss, VRAM metrics |
| **Rust Inference** | `8084` | `http://rust-inference:8084/metrics` | Batch prediction throughput, ONNX runtime parity |
| **cAdvisor** | `8085` | `http://cadvisor:8080/metrics` | Host/container resource utilization |
| **Go API Telemetry** | `8086` | `http://go-api:8086/metrics` | API requests/sec, SSE subscriber count, ClickHouse lag |
| **Gold Builder** | `8088` | `http://gold-builder:8088/metrics` | Batch aggregation rates, catalog synchronization |
| **NATS Exporter** | `7777` | `http://nats-exporter:7777/metrics` | JetStream message queues, consumer lag |
| **ClickHouse Metrics**| `9363` | `http://clickhouse:9363/metrics` | Query latency, disk write volume |

> ⚠️ **Rule:** Containers communicate using Docker service names (`minio`, `nats`, `go-api`), never `localhost`.

Grafana is excluded from the default Compose stack because the AURORA UI reads
Prometheus telemetry through the Go API. Start Grafana only for ad-hoc PromQL
and engineering diagnostics:

```bash
docker compose --profile observability up -d grafana
```

## 3. Sub-Project Environment Files

Each sub-project owns its `.env.example` in its application directory:

* `apps/go-ingester/.env.example`
* `apps/rust-preprocessor/.env.example`
* `apps/python-gold-builder/.env.example`
* `apps/python-ml-worker/.env.example`
* `apps/rust-inference/.env.example`
* `apps/go-api/.env.example`
* `apps/dashboard/.env.example`

## 4. Secret & Redaction Policy

1. Never commit `.env` or real credentials to Git.
2. Credentials (`MINIO_SECRET_KEY`, passwords, tokens) must never be logged during service startup configuration dumps.
3. Change all development defaults before deployment. In particular, set non-default MinIO credentials, Grafana credentials when the optional profile is enabled, and a specific `AURORA_CORS_ALLOWED_ORIGIN`.

## 5. Go API data access

The Go API reads ClickHouse from `AURORA_CLICKHOUSE_ENDPOINT` and `AURORA_CLICKHOUSE_DATABASE`. Browser CORS is restricted to the exact origin in `AURORA_CORS_ALLOWED_ORIGIN`; wildcard origins are rejected.

ClickHouse HTTP access uses `AURORA_CLICKHOUSE_USER` and `AURORA_CLICKHOUSE_PASSWORD`. The Compose development defaults are intentionally explicit so a network request cannot silently fall back to the disabled `default` account.

The analytical endpoints return `503 Service Unavailable` when ClickHouse is unreachable. They never return fabricated candidate, anomaly, target, or lightcurve records.

`GET /healthz` is process liveness. `GET /readyz` performs bounded MinIO and
ClickHouse checks and returns `503` until both dependencies are ready. Candidate
and anomaly endpoints require `snapshot_id`; collection responses are bounded
by `limit`/`offset` pagination.

## 6. GPU & Device Selection

`python-ml-worker` may select its training device independently. For
`rust-inference`, `AURORA_ML_DEVICE=auto` is the portable default: CUDA is used
when its ONNX Runtime provider can be loaded, otherwise the worker falls back to
the CPU provider while preserving the same model package and parity contract.
Set `cuda` to require GPU inference or `cpu` to force CPU inference.

## 7. Stage 5 Light Curve Feature Configuration

`python-ml-worker` supports the following scientific feature environment variables:

| Variable | Default | Description |
| :--- | :--- | :--- |
| `AURORA_LC_FEATURE_VERSION` | `lc-features-v1` | Light Curve feature schema version |
| `AURORA_LC_BLS_MIN_PERIOD_DAYS` | `0.5` | Minimum BLS period search limit (days) |
| `AURORA_LC_BLS_MAX_PERIOD_DAYS` | `20.0` | Maximum BLS period search limit (days) |
| `AURORA_LC_MIN_POINTS` | `100` | Minimum required light curve cadence rows for BLS |

## 8. Stage 5 TPF & FFI Evidence Configuration

| Variable | Default | Description |
| :--- | :--- | :--- |
| `AURORA_TPF_FEATURE_VERSION` | `tpf-vetting-v1` | TPF vetting evidence schema version |
| `AURORA_TPF_TRANSIT_WINDOW_FACTOR` | `1.0` | In-transit window width multiplier (`factor * duration / 2`) |
| `AURORA_TPF_OUT_GUARD_FACTOR` | `2.0` | Out-of-transit guard zone multiplier |
| `AURORA_TPF_MIN_IN_TRANSIT_CADENCES` | `3` | Minimum required cadences inside transit window |
| `AURORA_FFI_FEATURE_VERSION` | `ffi-evidence-v1` | FFI evidence schema version |

## 9. Stage 5 Catalog & Label Configuration

| Variable | Default | Description |
| :--- | :--- | :--- |
| `AURORA_TOI_PERIOD_REL_TOLERANCE` | `0.05` | Maximum relative period tolerance for TOI candidate matching |
| `AURORA_LABEL_POLICY_VERSION` | `candidate-label-policy-v1` | Versioned policy mapping catalog status to ML label |
| `AURORA_TOI_MATCH_VERSION` | `toi-match-v1` | Versioned TOI ephemeris matching algorithm |
| `AURORA_TIC_SOURCE` | `local` | Source for TIC catalog snapshots (`local` or URI) |
| `AURORA_TOI_SOURCE` | `local` | Source for TOI catalog snapshots (`local` or URI) |
| `AURORA_TCE_SOURCE` | `local` | Source for TCE catalog snapshots (`local` or URI) |
