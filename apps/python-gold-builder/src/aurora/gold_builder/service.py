"""Non-interactive Gold Builder process bootstrap for systemd and Docker."""

from __future__ import annotations

import asyncio

from .application.worker import run_worker
from .config import Config


def main() -> None:
    """Start the only supported Gold Builder process: the durable worker."""
    asyncio.run(run_worker(Config.from_env()))


if __name__ == "__main__":
    main()
