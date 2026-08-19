# AURORA Cosmic Data Platform — Architecture Blueprint

## 1. Overview & Core Philosophy

**AURORA** is a high-throughput astronomical data processing pipeline and anomaly inference engine for NASA TESS and Kepler observations.

The platform operates on a **rolling bounded storage model**:
- Raw FITS storage is strictly bounded to **~50 GiB** in MinIO Bronze.
- Raw files are safely evicted once derived datasets (Silver/Gold Parquet), checkpoints, and data lineage are persisted.
- Derived knowledge (Gold features, trained ONNX models, catalog indices, and predictions) accumulates indefinitely.

---

## 2. End-to-End System Architecture

```
                                            ┌────────────────────────┐
                                            │  NASA / MAST Archive   │
                                            └───────────┬────────────┘
                                                        │ (HTTPS Stream)
                                                        ▼
                                            ┌────────────────────────┐
                                            │      go-ingester       │
                                            └─────┬────────────┬─────┘
                               (Stream FITS)      │            │ (Object-Ready Event)
                    ┌─────────────────────────────┘            └─────────────────────────────┐
                    ▼                                                                        ▼
         ┌─────────────────────┐                                                  ┌─────────────────────┐
         │      MinIO S3       │ ◄─────────────────────────────────────────────── │   NATS JetStream    │
         │     (Data Lake)     │ ───────────────────────────────────────────────► │   (Control Plane)   │
         └──────────┬──────────┘                                                  └──────────┬──────────┘
                    │                                                                        │
                    ├────────────────────────────────────┬───────────────────────────────────┤
                    │ (Bronze FITS)                      │                                   │ (NATS ML/Infer Job)
                    ▼                                    ▼                                   ▼
         ┌─────────────────────┐              ┌─────────────────────┐             ┌─────────────────────┐
         │  rust-preprocessor  │              │ python-gold-builder │             │   rust-inference    │
         │  (FITS -> Parquet)  │              │ (Feature Aggregator │             │ (ONNX Runtime CPU/  │
         │  (Tokio / Rayon)    │              │  & Catalog Joins)   │             │  CUDA Hot-Reload)   │
         └──────────┬──────────┘              └──────────┬──────────┘             └──────────┬──────────┘
                    │ (Silver/Gold Parquet)              │ (Gold Features)                   │ (Scores / Inferences)
                    ▼                                    ▼                                   │
         ┌─────────────────────┐              ┌─────────────────────┐                        │
         │    MinIO Storage    │ ───────────► │  python-ml-worker   │                        │
         │ (Silver / Gold Parq)│              │ (PyTorch/CUDA Train │                        │
         └─────────────────────┘              │  Eval & ONNX Export)│                        │
                                              └──────────┬──────────┘                        │
                                                         │ (Export ONNX)                     │
                                                         ▼                                   │
                                              ┌─────────────────────┐                        │
                                              │    MinIO Models     │ ───────────────────────┤
                                              │  (Versioned ONNX)   │                        │
                                              └─────────────────────┘                        │
                                                                                             ▼
                                              ┌─────────────────────┐             ┌─────────────────────┐
                                              │     ClickHouse      │ ◄───────────┤       go-api        │
                                              │  (Analytics Store)  │             │ (REST/SSE Gateway & │
                                              └──────────┬──────────┘             │  Physics Engine)    │
                                                         │                        └──────────┬──────────┘
                                                         │ (Analytical Queries)              │ (REST / SSE Feed)
                                                         └──────────────────────────────────►▼
                                                                                  ┌─────────────────────┐
                                                                                  │      dashboard      │
                                                                                  │  (React 19 + Vite)  │
                                                                                  └─────────────────────┘
```

---

## 3. Subsystem Responsibilities

| Subsystem | Stack | Primary Responsibilities |
|---|---|---|
| **`go-ingester`** | Go 1.26 | Stream downloads from MAST to MinIO Bronze, enforce ~50 GiB rolling storage quota, track ingestion checkpoints, emit `bronze-object-ready` NATS events. |
| **`rust-preprocessor`** | Rust 1.89, Tokio | Bounded concurrent FITS parsing, detrending, FFT & BLS period search, outlier filtering, write Silver & Gold Parquet to MinIO. |
| **`python-gold-builder`** | Python 3.12, Polars/DuckDB | Build and maintain cumulative Gold analytical datasets, join TIC/TOI catalog metadata, index features into ClickHouse. |
| **`python-ml-worker`** | Python 3.12, PyTorch/CUDA | Train light-curve classifiers & anomaly autoencoders, run Champion vs Challenger evaluation, export validated models to ONNX. |
| **`rust-inference`** | Rust 1.89, ONNX Runtime | High-throughput batch inference (CPU/CUDA fallback), hot-swap model reloading from MinIO, consume prediction jobs from NATS. |
| **`go-api`** | Go 1.26, Chi/Stdlib | REST & SSE API Gateway, exoplanet physics & habitability classification, telemetry and health monitoring. |
| **`dashboard`** | React 19, Vite, Tailwind | Interactive visual analytics, light curve rendering, candidate vetting, model metrics, and system monitoring. |

---

## 4. Storage & State Separation

```
                    ┌─────────────────────────┐
                    │      AURORA STATE       │
                    └────────────┬────────────┘
         ┌───────────────────────┼───────────────────────┐
         ▼                       ▼                       ▼
┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
│      MinIO       │   │  NATS JetStream  │   │    ClickHouse    │
│   (Data Plane)   │   │  (Control Plane) │   │ (Analytics View) │
├──────────────────┤   ├──────────────────┤   ├──────────────────┤
│ • bronze/ (raw)  │   │ • Object ready   │   │ • Candidates     │
│ • silver/ (clean)│   │ • Preprocess jobs│   │ • Light curve st.│
│ • gold/ (feats)  │   │ • Ingest events  │   │ • Anomalies      │
│ • models/ (onnx) │   │ • Eval triggers  │   │ • Habitability   │
│ • checkpoints/   │   │ • System errors  │   │ • Ingestion logs │
└──────────────────┘   └──────────────────┘   └──────────────────┘
```

---

## 5. Core System Invariants & Rules

1. **Zero Large Binaries in Event Bus**: NATS messages only carry object keys and metadata; FITS/Parquet binaries reside exclusively in MinIO.
2. **Persistence Precedes Notification**: Data must be safely committed to MinIO before publishing an event to NATS.
3. **Bounded Concurrency**: Ingestion, Rust preprocessing, and ML inference run under strict concurrency semaphores to protect RAM/VRAM limits.
4. **Idempotency & Checkpoints**: Every pipeline stage records deterministic checkpoints in MinIO to support transparent crash recovery.
5. **Safe Eviction Lifecycle**: Bronze raw FITS can only be purged after downstream Silver/Gold artifacts and lineage metadata are durably stored.
6. **Immutable Models & Shadow Promotion**: New ML models are deployed as challengers and must satisfy evaluation criteria before champion promotion.
7. **Optional GPU with Fallback**: All ML and inference components must function on CPU if CUDA is unavailable.

---

## 6. Development & Deployment Summary

- **Single Command Bootstrapping**: Managed via `docker-compose.yml` and `Makefile` (`make init`, `make up`, `make down`).
- **Telemetry**: Prometheus metrics exposed on all services (`/metrics`), visualized in Dashboard and Grafana.
- **Contract Driven**: Schemas defined under `contracts/data/` and `contracts/events/` ensure cross-language compatibility across Go, Rust, and Python.
