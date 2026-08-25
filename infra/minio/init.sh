#!/bin/sh

set -e

MINIO_HOST="${MINIO_HOST:-minio}"
MINIO_PORT="${MINIO_PORT:-9000}"
MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-minioadmin}"
MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-minioadmin}"
MINIO_BUCKET="${MINIO_BUCKET:-aurora}"
AURORA_PREDICTION_BUCKET="${AURORA_PREDICTION_BUCKET:-${MINIO_BUCKET}}"

echo "Waiting for MinIO server at ${MINIO_HOST}:${MINIO_PORT}..."
until mc alias set myminio "http://${MINIO_HOST}:${MINIO_PORT}" "${MINIO_ACCESS_KEY}" "${MINIO_SECRET_KEY}"; do
  echo "MinIO server not ready yet. Retrying in 2 seconds..."
  sleep 2
done

echo "MinIO connected. Creating base bucket '${MINIO_BUCKET}' if not exists..."
mc mb myminio/"${MINIO_BUCKET}" --ignore-existing
if [ "${AURORA_PREDICTION_BUCKET}" != "${MINIO_BUCKET}" ]; then
  echo "Creating prediction bucket '${AURORA_PREDICTION_BUCKET}' if not exists..."
  mc mb myminio/"${AURORA_PREDICTION_BUCKET}" --ignore-existing
fi

echo "MinIO initialization completed successfully."
