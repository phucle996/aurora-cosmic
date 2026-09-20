"""ML Dataset Views & Feature Definitions (Pre-training Stage 1)."""

from __future__ import annotations

from dataclasses import dataclass, field
import hashlib
import json
from typing import Any, Dict, List, Set, Tuple

from store import SnapshotManifest as GoldSnapshotManifest

# Frozen v2 feature contract. Labels are supplied by the separate curated
# cohort, and TPF presence is guaranteed by Gold's completeness contract.
CANDIDATE_MODEL_INPUT_FEATURES: Tuple[str, ...] = (
    "bls_available",
    "bls_depth",
    "bls_duration",
    "bls_period",
    "bls_power",
    "bls_transit_time",
    "flux_amplitude",
    "flux_kurtosis",
    "flux_mad",
    "flux_mean",
    "flux_median",
    "flux_rms",
    "flux_robust_sigma",
    "flux_skewness",
    "flux_std",
    "logg",
    "max_gap",
    "median_cadence",
    "median_flux_err",
    "n_points",
    "pixel_mad_median",
    "stellar_mass",
    "stellar_radius",
    "teff",
    "tic_available",
    "time_span",
    "tmag",
    "transit_deficit_center_offset_pixels",
    "transit_deficit_centroid_col",
    "transit_deficit_centroid_row",
    "transit_deficit_sum",
)

# Frozen List of 14 ANOMALY MODEL_INPUT Features in Deterministic Order
ANOMALY_MODEL_INPUT_FEATURES: Tuple[str, ...] = (
    "n_points",
    "time_span",
    "median_cadence",
    "max_gap",
    "flux_mean",
    "flux_median",
    "flux_std",
    "flux_mad",
    "flux_robust_sigma",
    "flux_amplitude",
    "flux_rms",
    "flux_skewness",
    "flux_kurtosis",
    "median_flux_err",
)

# Strict Leakage Prevention Exclusion List
LEAKAGE_EXCLUSIONS: Set[str] = {
    "source_product_id",
    "lineage_id",
    "sample_id",
    "tic_id",
    "sector",
    "silver_sha256",
    "lc_feature_version",
    "lc_feature_fingerprint",
    "matched_toi_id",
    "toi_match_status",
    "toi_period_error",
    "training_label",
}


class MlDatasetError(Exception):
    """Raised when Gold dataset view validation fails."""

    pass


@dataclass(frozen=True)
class CandidateMlView:
    """Model-specific ML dataset view conforming to ml-dataset-view-v1.md."""

    gold_snapshot_id: str
    gold_manifest_sha256: str
    view_fingerprint: str
    dataset_view_version: str = "candidate-ml-view-v1"
    feature_names: Tuple[str, ...] = CANDIDATE_MODEL_INPUT_FEATURES
    total_row_count: int = 0
    supervised_eligible_count: int = 0
    positive_count: int = 0
    negative_count: int = 0
    unresolved_count: int = 0
    excluded_count: int = 0
    rows: List[Dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "dataset_view_version": self.dataset_view_version,
            "gold_snapshot_id": self.gold_snapshot_id,
            "gold_manifest_sha256": self.gold_manifest_sha256,
            "view_fingerprint": self.view_fingerprint,
            "feature_names": list(self.feature_names),
            "total_row_count": self.total_row_count,
            "supervised_eligible_count": self.supervised_eligible_count,
            "positive_count": self.positive_count,
            "negative_count": self.negative_count,
            "unresolved_count": self.unresolved_count,
            "excluded_count": self.excluded_count,
        }


@dataclass(frozen=True)
class AnomalyMlView:
    """Anomaly light-curve ML dataset view (anomaly-lightcurve-ml-view-v1)."""

    gold_snapshot_id: str
    gold_manifest_sha256: str
    view_fingerprint: str
    dataset_view_version: str = "anomaly-lightcurve-ml-view-v1"
    feature_names: Tuple[str, ...] = ANOMALY_MODEL_INPUT_FEATURES
    total_row_count: int = 0
    rows: List[Dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "dataset_view_version": self.dataset_view_version,
            "gold_snapshot_id": self.gold_snapshot_id,
            "gold_manifest_sha256": self.gold_manifest_sha256,
            "view_fingerprint": self.view_fingerprint,
            "feature_names": list(self.feature_names),
            "total_row_count": self.total_row_count,
        }


def derive_view_fingerprint(
    view_version: str,
    snapshot_id: str,
    manifest_sha256: str,
    feature_names: Tuple[str, ...],
    product_ids: List[str],
) -> str:
    """Compute deterministic SHA-256 fingerprint for dataset view."""
    payload = {
        "dataset_view_version": view_version,
        "feature_names": list(feature_names),
        "gold_manifest_sha256": manifest_sha256,
        "gold_snapshot_id": snapshot_id,
        "source_product_ids": sorted(product_ids),
    }
    canonical_json = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()


def build_candidate_ml_view(
    manifest: GoldSnapshotManifest,
    candidate_rows: List[Dict[str, Any]],
) -> CandidateMlView:
    """Build candidate ML dataset view from committed Gold snapshot manifest & rows."""
    if manifest.snapshot_type != "CANDIDATE":
        raise MlDatasetError(
            f"UNSUPPORTED_ML_DATASET_SOURCE: Snapshot type '{manifest.snapshot_type}' is not CANDIDATE"
        )
    if manifest.gold_schema_version not in {"gold-candidate-v1", "gold-candidate-v4"}:
        raise MlDatasetError(
            f"UNSUPPORTED_ML_DATASET_SOURCE: Gold schema '{manifest.gold_schema_version}' is not a supported candidate contract"
        )

    product_ids = []
    pos_c, neg_c, unres_c, excl_c = 0, 0, 0, 0

    for row in candidate_rows:
        pid = row.get("source_product_id")
        if not pid:
            raise MlDatasetError(
                "Gold candidate row missing required 'source_product_id'"
            )
        product_ids.append(str(pid))

        lbl = row.get("training_label", "UNRESOLVED")
        if lbl == "POSITIVE":
            pos_c += 1
        elif lbl == "NEGATIVE":
            neg_c += 1
        elif lbl == "EXCLUDED":
            excl_c += 1
        else:
            unres_c += 1

    manifest_sha = hashlib.sha256(
        json.dumps(manifest.to_dict(), sort_keys=True, separators=(",", ":")).encode(
            "utf-8"
        )
    ).hexdigest()

    v_fingerprint = derive_view_fingerprint(
        view_version="candidate-ml-view-v2",
        snapshot_id=manifest.snapshot_id,
        manifest_sha256=manifest_sha,
        feature_names=CANDIDATE_MODEL_INPUT_FEATURES,
        product_ids=product_ids,
    )

    return CandidateMlView(
        gold_snapshot_id=manifest.snapshot_id,
        gold_manifest_sha256=manifest_sha,
        view_fingerprint=v_fingerprint,
        dataset_view_version="candidate-ml-view-v2",
        feature_names=CANDIDATE_MODEL_INPUT_FEATURES,
        total_row_count=len(candidate_rows),
        supervised_eligible_count=pos_c + neg_c,
        positive_count=pos_c,
        negative_count=neg_c,
        unresolved_count=unres_c,
        excluded_count=excl_c,
        rows=candidate_rows,
    )


def build_anomaly_ml_view(
    manifest: GoldSnapshotManifest,
    anomaly_rows: List[Dict[str, Any]],
) -> AnomalyMlView:
    """Build anomaly light-curve ML dataset view from committed Gold snapshot manifest & rows."""
    product_ids = []
    for row in anomaly_rows:
        pid = row.get("source_product_id")
        if not pid:
            raise MlDatasetError(
                "Gold anomaly row missing required 'source_product_id'"
            )
        product_ids.append(str(pid))

    manifest_sha = hashlib.sha256(
        json.dumps(manifest.to_dict(), sort_keys=True, separators=(",", ":")).encode(
            "utf-8"
        )
    ).hexdigest()

    v_fingerprint = derive_view_fingerprint(
        view_version="anomaly-lightcurve-ml-view-v1",
        snapshot_id=manifest.snapshot_id,
        manifest_sha256=manifest_sha,
        feature_names=ANOMALY_MODEL_INPUT_FEATURES,
        product_ids=product_ids,
    )

    return AnomalyMlView(
        gold_snapshot_id=manifest.snapshot_id,
        gold_manifest_sha256=manifest_sha,
        view_fingerprint=v_fingerprint,
        dataset_view_version="anomaly-lightcurve-ml-view-v1",
        feature_names=ANOMALY_MODEL_INPUT_FEATURES,
        total_row_count=len(anomaly_rows),
        rows=anomaly_rows,
    )
