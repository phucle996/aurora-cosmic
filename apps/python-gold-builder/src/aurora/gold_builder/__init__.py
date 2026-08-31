"""AURORA's CPU-only Silver-to-Gold snapshot builder."""

from pathlib import Path
import sys

# Source-tree convenience: the scientific pipeline is shared with the ML app.
# The production image copies it into /app/aurora_ml/pipeline explicitly.
_worker_root = Path(__file__).resolve().parents[4] / "python-ml-worker"
if (_worker_root / "aurora_ml").is_dir() and str(_worker_root) not in sys.path:
    sys.path.insert(0, str(_worker_root))

from .application.materializer import GoldBuildError, GoldBuildResult, GoldBuilder  # noqa: E402
from .domain.events import SilverEvent  # noqa: E402

__all__ = ["GoldBuildError", "GoldBuildResult", "GoldBuilder", "SilverEvent"]
