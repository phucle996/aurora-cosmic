# AURORA Cosmic Data Platform

> High-Throughput Photometric Pipeline & Anomaly Inference Engine for TESS & Kepler NASA Missions.

---

## 📚 System Architecture & Specifications

* **Architecture Blueprint**: [ARCH.MD](./ARCH.MD)
* **Configuration Specification**: [docs/CONFIGURATION.md](./docs/CONFIGURATION.md)
* **Data & Event Contracts**: [contracts/README.md](./contracts/README.md)

---

## 🐳 Container Images (GHCR)

Latest release: **`v1.0.0-beta`** — published to [GitHub Container Registry](https://github.com/phucle996?tab=packages).

| Service | Image |
|---|---|
| Go Ingester | `ghcr.io/phucle996/aurora-cosmic/go-ingester:v1.0.0-beta` |
| Rust Preprocessor | `ghcr.io/phucle996/aurora-cosmic/rust-preprocessor:v1.0.0-beta` |
| Python Gold Builder | `ghcr.io/phucle996/aurora-gold-builder:latest` |
| Python ML Worker | `ghcr.io/phucle996/aurora-cosmic/python-ml-worker:v1.0.0-beta` |
| Rust Inference | `ghcr.io/phucle996/aurora-cosmic/rust-inference:v1.0.0-beta` |
| Go API | `ghcr.io/phucle996/aurora-cosmic/go-api:v1.0.0-beta` |
| Dashboard | `ghcr.io/phucle996/aurora-cosmic/dashboard:v1.0.0-beta` |

---

## 🚀 Development Workflow & Quick Start

### 1. Environment Setup
Copy default environment templates for all sub-projects:

```bash
cp apps/go-ingester/.env.example apps/go-ingester/.env
cp apps/rust-preprocessor/.env.example apps/rust-preprocessor/.env
cp apps/python-ml-worker/.env.example apps/python-ml-worker/.env
cp apps/python-gold-builder/.env.example apps/python-gold-builder/.env
cp apps/rust-inference/.env.example apps/rust-inference/.env
cp apps/go-api/.env.example apps/go-api/.env
cp apps/dashboard/.env.example apps/dashboard/.env
```

### 2. Run Stack
```bash
# Build and start the complete Docker Compose stack, including init services
make init

# Start or stop without rebuilding
make up
make down

# Stop and remove Compose volumes/data
make clean
```

---

## 🛠 Tech Stack

* **Ingestion**: Go 1.26
* **Preprocessing**: Rust 1.89 (Tokio, Rayon)
* **Gold Builder**: Python >=3.12 (Polars, DuckDB)
* **ML Worker**: Python >=3.12 (PyTorch, CUDA, ONNX Export)
* **Inference Runtime**: Rust 1.89 (ONNX Runtime CPU / CUDA)
* **API Gateway**: Go 1.26 (Chi / Gin, SSE, Astrophysics Engine)
* **Dashboard**: React 19, TypeScript, Vite, Tailwind CSS, Radix UI
* **Data Plane**: MinIO (S3 compatible object storage)
* **Analytics Store**: ClickHouse 24.3
* **Event / Control Plane**: NATS JetStream
* **Observability**: Prometheus & Grafana
