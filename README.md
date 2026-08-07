# AURORA Cosmic Data Platform

AURORA is a continuously evolving astronomical data platform built around NASA TESS observations for exoplanet candidate discovery and anomaly detection.

## Core Architecture & Tech Stack

* **Go** (`apps/go-ingester`, `apps/go-api`) — Ingestion streaming and Query API
* **Rust** (`apps/rust-preprocessor`, `apps/rust-inference`) — FITS Preprocessing pipeline and high-performance ONNX Inference
* **Python** (`apps/python-ml-worker`, `apps/dashboard`) — Feature extraction, ML Model Training & Evolution, and Interactive Dashboard
* **MinIO** — Object storage for Bronze, Silver, Gold datasets, and Model artifacts
* **NATS JetStream** — Event streaming & control plane

## Documentation

* [ARCH.md](file:///home/phucle/Desktop/aurora-cosmic/ARCH.md) — System Architecture Specification
* [STRUCTURE.md](file:///home/phucle/Desktop/aurora-cosmic/STRUCTURE.md) — Monorepo Layout & Data Flow Isolation Rules
* [STAGE.MD](file:///home/phucle/Desktop/aurora-cosmic/STAGE.MD) — 8-Stage Development Roadmap

## Current Stage

**Stage 1 — Foundation & Infrastructure** (Phase 1.1 — Repository Foundation)
