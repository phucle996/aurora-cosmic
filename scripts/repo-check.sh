#!/usr/bin/env bash
set -euo pipefail

echo "==> Running AURORA repository sanity checks..."

# 1. Check required root files
for file in README.md ARCH.MD Makefile docker-compose.yml; do
    if [ ! -f "$file" ]; then
        echo "❌ Error: Required root file '$file' is missing."
        exit 1
    fi
done
echo "✓ Root files verified."

# 2. Check required application directories
for app in apps/go-ingester apps/rust-preprocessor apps/python-ml-worker apps/rust-inference apps/go-api apps/dashboard; do
    if [ ! -d "$app" ]; then
        echo "❌ Error: Required application directory '$app' is missing."
        exit 1
    fi
    if [ ! -f "$app/.env.example" ]; then
        echo "❌ Error: Sub-project '$app' is missing .env.example file."
        exit 1
    fi
done
echo "✓ Application directories and sub-project .env.example files verified."

# 3. Ensure forbidden tracking files (secrets, heavy binary formats) are not committed
FORBIDDEN_PATTERNS=("*.fits" "*.parquet" "*.onnx" ".env")
for pattern in "${FORBIDDEN_PATTERNS[@]}"; do
    if git ls-files --error-unmatch "$pattern" >/dev/null 2>&1; then
        echo "❌ Error: Forbidden tracked file detected matching pattern '$pattern'."
        exit 1
    fi
done
echo "✓ No forbidden committed binary artifacts or secrets found."

echo "==> Repository check passed successfully!"
