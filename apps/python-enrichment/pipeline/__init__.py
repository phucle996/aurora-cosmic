"""Scientific data processing pipeline for multimodal Enrichment/Gold."""

from pipeline.catalogs import CatalogBundle, CatalogSnapshotError
from pipeline.materializer import (
    EnrichmentBuildError,
    EnrichmentBuildResult,
    EnrichmentBuilder,
)
from pipeline.tpf_features import TpfFeatureError, extract_tpf_row
from pipeline.training_cohort import (
    COHORT_POLICY_VERSION,
    CohortLabel,
    auto_label_candidate,
    label_rows,
)

__all__ = [
    "EnrichmentBuilder",
    "EnrichmentBuildResult",
    "EnrichmentBuildError",
    "CatalogBundle",
    "CatalogSnapshotError",
    "TpfFeatureError",
    "extract_tpf_row",
    "COHORT_POLICY_VERSION",
    "CohortLabel",
    "auto_label_candidate",
    "label_rows",
]
