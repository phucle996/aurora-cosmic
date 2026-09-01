"""Non-interactive Gold Builder process bootstrap for systemd and Docker."""

from __future__ import annotations

import asyncio

from .application.worker import run_worker
from .config import Config
from .observer import Metrics, MetricsServer


def main() -> None:
    """Start the only supported Gold Builder process: the durable worker."""
    config = Config.from_env()
    metrics = Metrics()
    metrics_server = MetricsServer(config.metrics_addr, metrics)
    try:
        asyncio.run(run_worker(config, metrics))
    finally:
        metrics_server.close()


if __name__ == "__main__":
    main()
