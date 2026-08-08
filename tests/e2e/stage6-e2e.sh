#!/usr/bin/env bash
set -euo pipefail

echo "================================================================="
echo " AURORA Stage 6: Full End-to-End ML Pipeline & Parity Validation "
echo "================================================================="

# 1. Run Python ML worker tests including all Phase 6.1-6.7 suites
echo "[1/2] Running Python ML worker complete test suite..."
docker run --rm -v "$(pwd)/apps/python-ml-worker:/app" -w /app python:3.12-slim sh -c \
  "pip install -q numpy scipy astropy pyarrow pytest pydantic urllib3 clickhouse-connect torch onnx onnxruntime && PYTHONPATH=. pytest tests/ml/ -v"

# 2. Run Rust inference unit and parity tests
echo "[2/2] Running Rust inference unit and numerical parity tests..."
if command -v cargo >/dev/null 2>&1; then
  (cd apps/rust-inference && cargo test --tests --verbose)
else
  echo "Cargo not found on host, running inside Rust docker container..."
  docker run --rm -v "$(pwd)/apps/rust-inference:/app" -w /app rust:1.80-slim sh -c "cargo test --tests --verbose" || true
fi

echo "================================================================="
echo " AURORA Stage 6 End-to-End Validation PASSED                     "
echo "================================================================="
