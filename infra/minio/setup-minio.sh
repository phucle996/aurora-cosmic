#!/usr/bin/env bash
set -euo pipefail

MINIO_HOST="${MINIO_HOST:-127.0.0.1}"
MINIO_PORT="${MINIO_PORT:-9000}"
MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-minioadmin}"
MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-minioadmin}"
MINIO_BUCKET="${MINIO_BUCKET:-aurora}"
AURORA_PREDICTION_BUCKET="${AURORA_PREDICTION_BUCKET:-${MINIO_BUCKET}}"

echo "==> Initializing MinIO buckets at http://${MINIO_HOST}:${MINIO_PORT}..."
for i in {1..30}; do
    if mc alias set aurora-local "http://${MINIO_HOST}:${MINIO_PORT}" "${MINIO_ACCESS_KEY}" "${MINIO_SECRET_KEY}" >/dev/null 2>&1; then
        break
    fi
    echo "Waiting for MinIO to be ready... (${i}/30)"
    sleep 1
done

mc mb aurora-local/"${MINIO_BUCKET}" --ignore-existing
if [ "${AURORA_PREDICTION_BUCKET}" != "${MINIO_BUCKET}" ]; then
    mc mb aurora-local/"${AURORA_PREDICTION_BUCKET}" --ignore-existing
fi

echo "==> MinIO buckets initialized successfully."
