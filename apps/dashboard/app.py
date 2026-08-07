import sys
from config import Config

def main():
    try:
        cfg = Config()
        cfg.log_summary()
    except ValueError as err:
        print(f"[aurora-dashboard] Startup configuration error: {err}", file=sys.stderr)
        sys.exit(1)

    print(f"[aurora-dashboard] Dashboard running on {cfg.host}:{cfg.port}...")

if __name__ == "__main__":
    main()
