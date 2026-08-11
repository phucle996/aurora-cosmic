from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

from .builder import GoldBuilder
from .config import Config
from .events import SilverEvent
from .store import MinioObjectStore
from .worker import run_worker


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="AURORA Silver to Gold Builder")
    sub = parser.add_subparsers(dest="command", required=True)

    build = sub.add_parser("build", help="Build a candidate Gold snapshot")
    build.add_argument(
        "--events-file", required=True, help="JSON array of Silver events"
    )
    build.add_argument("--set-current", action="store_true")

    sub.add_parser("worker", help="Consume Silver events and build Gold batches")
    return parser


def main() -> None:
    args = _parser().parse_args()
    if args.command == "worker":
        asyncio.run(run_worker(Config.from_env()))
        return

    config = Config.from_env()
    payload = json.loads(Path(args.events_file).read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise SystemExit("--events-file must contain a JSON array")
    events = [SilverEvent.from_dict(item) for item in payload]
    builder = GoldBuilder(
        store=MinioObjectStore(
            config.minio_endpoint,
            config.minio_access_key,
            config.minio_secret_key,
        ),
        default_bucket=config.minio_bucket,
    )
    result = builder.build_candidate(events, set_current=args.set_current)
    print(json.dumps(result.__dict__, sort_keys=True))
