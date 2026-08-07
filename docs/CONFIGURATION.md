# AURORA Platform Configuration Specification

This document details the configuration model, priority hierarchy, environment variables, internal vs host addressing, secret policies, and device selection.

## 1. Configuration Priority Hierarchy

```text
Environment Variables
        │
        ▼
Service-local Configuration / Defaults
        │
        ▼
Platform Policy (config/aurora.example.yaml)
```

## 2. Docker Internal vs. Host Endpoints

| Service | Container Internal Endpoint | Host Development Endpoint |
| :--- | :--- | :--- |
| **MinIO API** | `http://minio:9000` | `http://localhost:9000` |
| **MinIO Console** | `http://minio:9001` | `http://localhost:9001` |
| **NATS Client** | `nats://nats:4222` | `nats://localhost:4222` |
| **NATS Monitor** | `http://nats:8222` | `http://localhost:8222` |
| **Go API** | `http://go-api:8080` | `http://localhost:8080` |
| **Dashboard** | `http://dashboard:8501` | `http://localhost:8501` |

> ⚠️ **Rule:** Containers communicate using Docker service names (`minio`, `nats`, `go-api`), never `localhost`.

## 3. Environment Groups Overview

* **Core**: `AURORA_ENV`, `AURORA_LOG_LEVEL`
* **MinIO**: `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_BUCKET`
* **NATS**: `NATS_URL`
* **Ingestion**: `AURORA_INGEST_MODE`, `AURORA_INGEST_CONCURRENCY`
* **Bronze Storage Budget**: `AURORA_BRONZE_MAX_BYTES`, `AURORA_BRONZE_HIGH_WATERMARK`, `AURORA_BRONZE_LOW_WATERMARK`
* **Preprocessor**: `AURORA_PREPROCESS_WORKERS`
* **API & Dashboard**: `AURORA_API_HOST`, `AURORA_API_PORT`, `AURORA_DASHBOARD_PORT`, `AURORA_API_URL`
* **ML / GPU**: `AURORA_ML_DEVICE`, `AURORA_ML_BATCH_SIZE`, `AURORA_ML_MAX_VRAM_MB`, `CUDA_VISIBLE_DEVICES`

## 4. Secret & Redaction Policy

1. Never commit `.env` or real credentials to Git.
2. Credentials (`MINIO_SECRET_KEY`, passwords, tokens) must never be logged during service startup configuration dumps.

## 5. GPU & Device Selection

`AURORA_ML_DEVICE` supports:
* `auto` (default): Detects CUDA availability automatically; falls back to CPU if unavailable.
* `cpu`: Forces CPU execution.
* `cuda`: Forces CUDA execution; fails at startup if CUDA is unavailable.
