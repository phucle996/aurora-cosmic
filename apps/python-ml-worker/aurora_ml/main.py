import sys
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
    except Exception as e:
        logger.error(f"Failed to start: {e}", exc_info=True)


if __name__ == "__main__":
    main()
