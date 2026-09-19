"""AURORA's CPU-only Silver-to-Gold / Enrichment snapshot builder."""

from pathlib import Path
import sys

# Source-tree convenience: the scientific pipeline is shared with the ML app.
# The production image copies it into /app/aurora_ml/pipeline explicitly.
_worker_root = Path(__file__).resolve().parent.parent / "python-ml-worker"
if (_worker_root / "aurora_ml").is_dir() and str(_worker_root) not in sys.path:
    sys.path.insert(0, str(_worker_root))

from events import SilverEvent  # noqa: E402
from pipeline.materializer import (  # noqa: E402
    EnrichmentBuildError,
    EnrichmentBuildResult,
    EnrichmentBuilder,
)

__all__ = [
    "EnrichmentBuildError",
    "EnrichmentBuildResult",
    "EnrichmentBuilder",
    "SilverEvent",
]
