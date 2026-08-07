from aurora_ml.config import Config


def main():
    print("[aurora-ml-worker] Starting Python PyTorch ML worker service...")
    try:
        cfg = Config()
        cfg.log_summary()
    except Exception as e:
        print(f"[aurora-ml-worker] Failed to start: {e}")


if __name__ == "__main__":
    main()
