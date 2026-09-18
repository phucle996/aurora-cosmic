#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INIT_SQL="${SCRIPT_DIR}/init.sql"

echo "==> Initializing ClickHouse database and schemas..."
for i in {1..30}; do
    if clickhouse client --host 127.0.0.1 --port 9004 --user default --query "SELECT 1" >/dev/null 2>&1; then
        break
    fi
    echo "Waiting for ClickHouse to be ready... (${i}/30)"
    sleep 1
done

clickhouse client --host 127.0.0.1 --port 9004 --user default --multiquery < "${INIT_SQL}"
echo "==> ClickHouse initialized successfully!"
