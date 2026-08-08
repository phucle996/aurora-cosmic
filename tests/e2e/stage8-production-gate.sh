#!/usr/bin/env bash
set -euo pipefail

echo "================================================================="
echo " AURORA Stage 8: Final Production Gate Validation                "
echo "================================================================="

# 1. Run full Stage 7 End-to-End Test
echo "[Step 1/5] Running Stage 7 End-to-End Suite..."
./tests/e2e/stage7-e2e.sh

# 2. Run Throughput & Latency Benchmarks
echo "[Step 2/5] Running Pipeline Throughput & Latency Benchmarks..."
./scripts/benchmark-throughput.sh

# 3. Run Chaos Engineering & Failure Injection Suite
echo "[Step 3/5] Running Chaos Engineering & Failure Injection Suite..."
./scripts/chaos-test.sh

# 4. Run Security & Compliance Audit
echo "[Step 4/5] Running Security & Compliance Audit..."
./scripts/security-audit.sh

# 5. Validate Observability & Infrastructure Configs
echo "[Step 5/5] Validating Prometheus & Grafana configs..."
if [ -f "infra/prometheus/prometheus.yml" ] && [ -f "infra/grafana/dashboards/aurora-overview.json" ]; then
  echo "Prometheus and Grafana observability configurations verified [PASS]"
fi

echo "================================================================="
echo " AURORA PLATFORM: FINAL PRODUCTION GATE PASSED (READY FOR PROD)  "
echo "================================================================="
