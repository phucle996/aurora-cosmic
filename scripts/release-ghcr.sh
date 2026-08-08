#!/usr/bin/env bash
set -euo pipefail

REGISTRY="ghcr.io/phucle996/aurora-cosmic"
TAG="${TAG:-v1.0.0-beta}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

SERVICES=(
  "go-ingester"
  "rust-preprocessor"
  "python-ml-worker"
  "rust-inference"
  "go-api"
  "dashboard"
)

echo "==> Logging in to GHCR..."
echo "${GHCR_TOKEN}" | docker login ghcr.io -u phucle996 --password-stdin

for svc in "${SERVICES[@]}"; do
  IMAGE="${REGISTRY}/${svc}:${TAG}"
  LATEST="${REGISTRY}/${svc}:latest"
  CTX="${REPO_ROOT}/apps/${svc}"

  echo ""
  echo "==> Building ${svc} -> ${IMAGE}"
  docker build \
    --platform linux/amd64 \
    -t "${IMAGE}" \
    -t "${LATEST}" \
    "${CTX}"

  echo "==> Pushing ${IMAGE}"
  docker push "${IMAGE}"
  docker push "${LATEST}"
  echo "    ✓ ${svc} pushed"
done

echo ""
echo "All 6 images pushed to ${REGISTRY} with tag ${TAG}"
