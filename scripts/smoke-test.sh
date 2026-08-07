#!/bin/bash

set -e

# Load environment variables if .env exists
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

MINIO_PORT="${MINIO_API_PORT:-9000}"
NATS_MON_PORT="${NATS_MONITOR_PORT:-8222}"

echo "==============================================================================="
echo "AURORA Local Infrastructure Smoke Test"
echo "==============================================================================="

# 1. Verify MinIO Health
echo -n "[1/2] Checking MinIO API at http://localhost:${MINIO_PORT}/minio/health/live... "
if curl -s -f "http://localhost:${MINIO_PORT}/minio/health/live" > /dev/null; then
  echo "OK"
else
  echo "FAILED"
  echo "Error: MinIO API is not responding on port ${MINIO_PORT}."
  exit 1
fi

# 2. Verify NATS JetStream Monitoring
echo -n "[2/2] Checking NATS Monitoring at http://localhost:${NATS_MON_PORT}/varz... "
if curl -s -f "http://localhost:${NATS_MON_PORT}/varz" > /dev/null; then
  echo "OK"
else
  echo "FAILED"
  echo "Error: NATS monitoring endpoint is not responding on port ${NATS_MON_PORT}."
  exit 1
fi

echo "==============================================================================="
echo "ALL INFRASTRUCTURE CHECKS PASSED!"
echo "==============================================================================="
exit 0
