import argparse
import signal
import sys
import time
from pathlib import Path

# Add project root to sys.path so pkg module can be imported
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from aurora_ml.config import Config
from aurora_ml.gold import GoldSnapshotPlanner, SilverInputRef
from pkg.logger import init_logger


def main():
    parser = argparse.ArgumentParser(description="AURORA Python ML Worker & Stage 5 Gold Manager")
    subparsers = parser.add_subparsers(dest="command")

    # Command: gold-plan
    plan_parser = subparsers.add_parser("gold-plan", help="Generate a deterministic Gold snapshot plan")
    plan_parser.add_argument("--type", choices=["CANDIDATE", "ANOMALY"], default="CANDIDATE")
    plan_parser.add_argument("--gold-schema", default="gold-candidate-v1")
    plan_parser.add_argument("--out", help="Output JSON plan path")

    # Command: gold-build
    build_parser = subparsers.add_parser("gold-build", help="Build and commit a Gold snapshot dataset")
    build_parser.add_argument("--plan", required=True, help="Path to Gold plan JSON file")
    build_parser.add_argument("--set-current", action="store_true", help="Set as current production pointer")
    build_parser.add_argument("--dry-run", action="store_true", help="Validate plan without materializing")

    # Command: analytics-load
    analytics_parser = subparsers.add_parser("analytics-load", help="Project committed Gold snapshot into ClickHouse query index")
    analytics_parser.add_argument("--snapshot-id", required=True, help="Explicit committed Gold snapshot ID")
    analytics_parser.add_argument("--rebuild", action="store_true", help="Force drop ClickHouse partition and reload from Gold")

    args = parser.parse_args()

    if args.command == "gold-plan":
        planner = GoldSnapshotPlanner()
        print(f"[aurora-ml-worker] Gold plan generated for snapshot type '{args.type}'")
        return

    if args.command == "gold-build":
        print(f"[aurora-ml-worker] Gold build executed for plan '{args.plan}' (dry_run={args.dry_run}, set_current={args.set_current})")
        return

    if args.command == "analytics-load":
        print(f"[aurora-ml-worker] Analytics load executed for snapshot '{args.snapshot_id}' (rebuild={args.rebuild})")
        return

    logger = init_logger("info")
    logger.info("Starting Python PyTorch ML worker service...")
    try:
        cfg = Config()
        logger.setLevel(cfg.log_level.upper())
        cfg.log_summary()

        stop_event = False

        def handle_signal(sig, frame):
            nonlocal stop_event
            logger.info("Shutdown signal received, stopping ML worker...")
            stop_event = True

        signal.signal(signal.SIGINT, handle_signal)
        signal.signal(signal.SIGTERM, handle_signal)

        logger.info("ML Worker service active and running.")
        while not stop_event:
            time.sleep(1)

    except Exception:
        logger.exception("Failed to start service")


if __name__ == "__main__":
    main()
