"""Non-interactive Enrichment worker process bootstrap for systemd and Docker.

Starts the Prometheus metrics HTTP endpoint and launches the durable
asyncio worker loop (`runtime.worker.run_worker`).
"""

from __future__ import annotations

import asyncio
from pathlib import Path
import sys

# Shared scientific pipeline: reuse tested Stage 5 candidate feature code from python-ml-worker
_worker_root = Path(__file__).resolve().parent.parent / "python-ml-worker"
if (_worker_root / "aurora_ml").is_dir() and str(_worker_root) not in sys.path:
    sys.path.insert(0, str(_worker_root))

from config import Config  # noqa: E402
from metrics import Metrics, MetricsServer  # noqa: E402
from runtime.worker import run_worker  # noqa: E402


def main() -> None:
    """Start the Enrichment service: metrics server + durable JetStream worker."""
    config = Config.from_env()
    metrics = Metrics()
    metrics_server = MetricsServer(config.metrics_addr, metrics)
    try:
        asyncio.run(run_worker(config, metrics))
    finally:
        metrics_server.close()


if __name__ == "__main__":
    main()
