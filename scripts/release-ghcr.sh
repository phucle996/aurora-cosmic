#!/usr/bin/env bash
set -euo pipefail

REGISTRY="ghcr.io/phucle996/aurora-cosmic"
TAG="${TAG:-v1.0.0-beta}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

SERVICES=(
  "go-ingester"
  "rust-preprocessor"
  "python-ml-worker"
  "python-gold-builder"
  "rust-inference"
  "go-api"
  "dashboard"
)

echo "==> Logging in to GHCR..."
echo "${GHCR_TOKEN}" | docker login ghcr.io -u phucle996 --password-stdin

for svc in "${SERVICES[@]}"; do
  IMAGE="${REGISTRY}/${svc}:${TAG}"
  LATEST="${REGISTRY}/${svc}:latest"
  
  if [ "${svc}" = "python-gold-builder" ]; then
    CTX="${REPO_ROOT}/apps"
    DOCKERFILE="${REPO_ROOT}/apps/python-gold-builder/Dockerfile"
    echo ""
    echo "==> Building ${svc} -> ${IMAGE}"
    docker build \
      --platform linux/amd64 \
      -f "${DOCKERFILE}" \
      -t "${IMAGE}" \
      -t "${LATEST}" \
      "${CTX}"
  else
    CTX="${REPO_ROOT}/apps/${svc}"
    echo ""
    echo "==> Building ${svc} -> ${IMAGE}"
    docker build \
      --platform linux/amd64 \
      -t "${IMAGE}" \
      -t "${LATEST}" \
      "${CTX}"
  fi

  echo "==> Pushing ${IMAGE}"
  docker push "${IMAGE}"
  docker push "${LATEST}"
  echo "    ✓ ${svc} pushed"
done

echo ""
echo "All 7 images pushed to ${REGISTRY} with tag ${TAG} and latest"
