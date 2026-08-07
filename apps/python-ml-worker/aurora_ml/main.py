import signal
import sys
import time
from pathlib import Path

# Add project root to sys.path so pkg module can be imported
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from aurora_ml.config import Config
from pkg.logger import init_logger


def main():
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
