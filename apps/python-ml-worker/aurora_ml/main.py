import sys
from aurora_ml.config import Config

def main():
    try:
        cfg = Config()
        cfg.log_summary()
    except ValueError as err:
        print(f"[aurora-ml-worker] Startup configuration error: {err}", file=sys.stderr)
        sys.exit(1)

    print("[aurora-ml-worker] Listening for Gold dataset training events...")

if __name__ == "__main__":
    main()
