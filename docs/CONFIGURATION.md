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

> ⚠️ **Rule:** Containers communicate using Docker service names (`minio`, `nats`, `go-api`), never `localhost`.

## 3. Sub-Project Environment Files

Each sub-project owns its `.env.example` in its application directory:

* `apps/go-ingester/.env.example`
* `apps/rust-preprocessor/.env.example`
* `apps/python-ml-worker/.env.example`
* `apps/rust-inference/.env.example`
* `apps/go-api/.env.example`
* `apps/dashboard/.env.example`

## 4. Secret & Redaction Policy

1. Never commit `.env` or real credentials to Git.
2. Credentials (`MINIO_SECRET_KEY`, passwords, tokens) must never be logged during service startup configuration dumps.

## 5. GPU & Device Selection

`AURORA_ML_DEVICE` supports:
* `auto` (default): Detects CUDA availability automatically; falls back to CPU if unavailable.
* `cpu`: Forces CPU execution.
* `cuda`: Forces CUDA execution; fails at startup if CUDA is unavailable.
