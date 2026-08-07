# AURORA Cosmic Data Platform

AURORA is a continuously evolving astronomical data platform built around NASA TESS observations for exoplanet candidate discovery and anomaly detection.

```text
Go       -> Ingestion streaming & Query API
Rust     -> FITS Preprocessing pipeline & ONNX Inference
Python   -> Analytics, ML Model Training & Dashboard
MinIO    -> Object Storage (Bronze / Silver / Gold / Models)
NATS     -> Event & Control Plane
```

## Documentation

* [ARCH.MD](ARCH.MD) — System Architecture Specification
* [STRUCTURE.MD](STRUCTURE.MD) — Monorepo Layout & Data Flow Isolation Rules
* [STAGE.MD](STAGE.MD) — 8-Stage Execution Roadmap
