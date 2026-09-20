#!/usr/bin/env bash
set -euo pipefail

BIN_DIR="${HOME}/.local/bin"
DATA_DIR="${HOME}/.local/share/aurora"
mkdir -p "${BIN_DIR}" "${DATA_DIR}/minio-data" "${DATA_DIR}/nats-data" "${DATA_DIR}/clickhouse-data" "${DATA_DIR}/clickhouse-log" "${DATA_DIR}/prometheus-data" "${HOME}/.cache/aurora-preprocessor"

echo "==> Setting up AURORA native infrastructure binaries in ${BIN_DIR}..."

# 1. MinIO Server
if ! command -v minio >/dev/null 2>&1; then
    echo "--> Installing MinIO server..."
    if command -v docker >/dev/null 2>&1; then
        ID=$(docker create quay.io/minio/minio:latest)
        docker cp "${ID}:/opt/bin/minio" "${BIN_DIR}/minio" 2>/dev/null || docker cp "${ID}:/usr/bin/minio" "${BIN_DIR}/minio"
        docker rm "${ID}" >/dev/null
    fi
    chmod +x "${BIN_DIR}/minio"
fi
echo "--> MinIO server: $(minio --version | head -n1)"

# 2. MinIO Client (mc)
if ! command -v mc >/dev/null 2>&1; then
    echo "--> Installing MinIO Client (mc)..."
    if command -v docker >/dev/null 2>&1; then
        ID=$(docker create quay.io/minio/mc:latest)
        docker cp "${ID}:/opt/bin/mc" "${BIN_DIR}/mc" 2>/dev/null || docker cp "${ID}:/usr/bin/mc" "${BIN_DIR}/mc"
        docker rm "${ID}" >/dev/null
    fi
    chmod +x "${BIN_DIR}/mc"
fi
echo "--> MinIO Client (mc): $(mc --version | head -n1)"

# 3. NATS Server
if ! command -v nats-server >/dev/null 2>&1; then
    echo "--> Downloading NATS server (v2.10.26)..."
    TMP_NATS="$(mktemp -d)"
    curl -fsSL "https://github.com/nats-io/nats-server/releases/download/v2.10.26/nats-server-v2.10.26-linux-amd64.tar.gz" | tar -xz -C "${TMP_NATS}"
    mv "${TMP_NATS}/nats-server-v2.10.26-linux-amd64/nats-server" "${BIN_DIR}/nats-server"
    chmod +x "${BIN_DIR}/nats-server"
    rm -rf "${TMP_NATS}"
fi
echo "--> NATS server: $(nats-server -v 2>&1 | head -n1)"

# 4. Prometheus
if ! command -v prometheus >/dev/null 2>&1; then
    echo "--> Downloading Prometheus (v2.51.0)..."
    TMP_PROM="$(mktemp -d)"
    curl -fsSL "https://github.com/prometheus/prometheus/releases/download/v2.51.0/prometheus-2.51.0.linux-amd64.tar.gz" | tar -xz -C "${TMP_PROM}"
    mv "${TMP_PROM}/prometheus-2.51.0.linux-amd64/prometheus" "${BIN_DIR}/prometheus"
    mv "${TMP_PROM}/prometheus-2.51.0.linux-amd64/promtool" "${BIN_DIR}/promtool"
    chmod +x "${BIN_DIR}/prometheus" "${BIN_DIR}/promtool"
    rm -rf "${TMP_PROM}"
fi
echo "--> Prometheus: $(prometheus --version 2>&1 | head -n1)"

# 5. ClickHouse
if ! command -v clickhouse >/dev/null 2>&1; then
    echo "--> Installing ClickHouse binary..."
    if [ -f "/tmp/clickhouse" ] && [ -x "/tmp/clickhouse" ]; then
        cp "/tmp/clickhouse" "${BIN_DIR}/clickhouse"
    else
        TMP_CH="$(mktemp -d)"
        (cd "${TMP_CH}" && curl -fsSL https://clickhouse.com/ | sh)
        mv "${TMP_CH}/clickhouse" "${BIN_DIR}/clickhouse"
        rm -rf "${TMP_CH}"
    fi
    chmod +x "${BIN_DIR}/clickhouse"
fi
echo "--> ClickHouse: $(clickhouse --version | head -n1)"

# 6. Prometheus NATS Exporter
if ! command -v prometheus-nats-exporter >/dev/null 2>&1; then
    echo "--> Downloading Prometheus NATS Exporter (v0.20.2)..."
    TMP_EXP="$(mktemp -d)"
    curl -fsSL "https://github.com/nats-io/prometheus-nats-exporter/releases/download/v0.20.2/prometheus-nats-exporter-v0.20.2-linux-x86_64.tar.gz" | tar -xz -C "${TMP_EXP}"
    mv "${TMP_EXP}/prometheus-nats-exporter" "${BIN_DIR}/prometheus-nats-exporter"
    chmod +x "${BIN_DIR}/prometheus-nats-exporter"
    rm -rf "${TMP_EXP}"
fi
echo "--> NATS Exporter: $(prometheus-nats-exporter -version 2>&1 | head -n1)"

echo "==> All AURORA infrastructure binaries are ready in ${BIN_DIR}!"

