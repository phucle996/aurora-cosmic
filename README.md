# AURORA Cosmic Data Platform

> High-Throughput Photometric Pipeline & Anomaly Inference Engine for TESS & Kepler NASA Missions.

---

## 📚 System Architecture & Specifications

* **Architecture**: [ARCH.MD](file:///home/phucle/Desktop/aurora-cosmic/ARCH.MD)
* **Monorepo Directory Structure**: [STRUCTURE.MD](file:///home/phucle/Desktop/aurora-cosmic/STRUCTURE.MD)
* **Execution Roadmap & Phases**: [STAGE.MD](file:///home/phucle/Desktop/aurora-cosmic/STAGE.MD)
* **Configuration Specification**: [docs/CONFIGURATION.md](file:///home/phucle/Desktop/aurora-cosmic/docs/CONFIGURATION.md)

---

## 🚀 Development Workflow & Quick Start

### 1. Environment Setup
Copy default environment templates for all sub-projects:

```bash
cp apps/go-ingester/.env.example apps/go-ingester/.env
cp apps/rust-preprocessor/.env.example apps/rust-preprocessor/.env
cp apps/python-ml-worker/.env.example apps/python-ml-worker/.env
cp apps/rust-inference/.env.example apps/rust-inference/.env
cp apps/go-api/.env.example apps/go-api/.env
cp apps/dashboard/.env.example apps/dashboard/.env
```

### 2. Sanity & Configuration Checks
```bash
./scripts/repo-check.sh
make config-check
```

### 3. Build & Run Stack
```bash
# Build all service containers
make build

# Start local MinIO, NATS, and microservice containers
make up

# Check container status & logs
make ps
make logs

# Run local infrastructure & stack smoke test
make smoke
```

### 4. Code Quality & Testing
```bash
# Format code across Go, Rust, and Python
make fmt

# Run linters (go vet, cargo clippy, ruff)
make lint

# Run unit test suites
make test
```

### 5. Shutdown
```bash
# Stop full stack preserving persistent volumes
make down
```

---

## 🛠 Tech Stack

* **Ingestion**: Go 1.26
* **Preprocessing**: Rust 1.89
* **ML Worker**: Python >=3.12 (`python:3.12-slim`, PyTorch/CUDA)
* **Inference Runtime**: Rust 1.89
* **API Gateway**: Go 1.26
* **Dashboard**: Python >=3.12 (Streamlit)
* **Data Plane**: MinIO (S3 compatible)
* **Event / Control Plane**: NATS JetStream
