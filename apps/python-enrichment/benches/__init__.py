"""Benchmark and profiling suite for aurora-enrichment."""

from pathlib import Path
import sys

# Ensure shared scientific pipeline code from python-ml-worker is discoverable
_app_root = Path(__file__).resolve().parent.parent
if str(_app_root) not in sys.path:
    sys.path.insert(0, str(_app_root))

_worker_root = _app_root.parent / "python-ml-worker"
if (_worker_root / "aurora_ml").is_dir() and str(_worker_root) not in sys.path:
    sys.path.insert(0, str(_worker_root))

from benches.profiler import HeapProfileResult, HeapTracker  # noqa: E402

__all__ = ["HeapProfileResult", "HeapTracker"]
