from pathlib import Path
import sys

_app_root = Path(__file__).resolve().parent.parent
if str(_app_root) not in sys.path:
    sys.path.insert(0, str(_app_root))

_worker_root = Path(__file__).resolve().parents[2] / "python-ml-worker"
if (_worker_root / "aurora_ml").is_dir() and str(_worker_root) not in sys.path:
    sys.path.insert(0, str(_worker_root))
