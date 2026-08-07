#!/usr/bin/env bash
set -euo pipefail

echo "========================================================"
echo "[E2E Stage 3] Validating Rust Preprocessing Subsystem"
echo "========================================================"

# 1. Environment & Path checks
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PREPROCESSOR_DIR="${REPO_ROOT}/apps/rust-preprocessor"

echo "Repository Root: ${REPO_ROOT}"
echo "Preprocessor Dir: ${PREPROCESSOR_DIR}"

# 2. Check Rust & Docker availability
if ! command -v docker >/dev/null 2>&1; then
    echo "ERROR: Docker executable not found in PATH."
    exit 1
fi

echo "[E2E Stage 3] Running Rust Preprocessor test suite in container..."
docker run --rm -v "${PREPROCESSOR_DIR}:/app" -w /app rust:alpine sh -c \
    "apk add --no-cache musl-dev cfitsio-dev pkgconfig 2>/dev/null && RUSTFLAGS=\"-C target-feature=-crt-static\" cargo test -- --test-threads=1"

echo "========================================================"
echo "[E2E Stage 3] SUCCESS: All preprocessing tests passed cleanly!"
echo "========================================================"
