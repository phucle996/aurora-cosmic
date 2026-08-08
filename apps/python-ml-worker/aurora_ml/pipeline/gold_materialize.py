"""Gold Dataset Materializer, PyArrow Explicit Schemas & Recovery Commit Manager.

Converts Stage 5 scientific feature/enrichment records into durable, immutable, reproducible
Gold Parquet datasets (gold-candidate-v1, gold-anomaly-v1).
"""

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import hashlib
import json
import os
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq

from aurora_ml.pipeline.catalogs import CandidateEnrichmentRecord
from aurora_ml.pipeline.evidence import FfiEvidenceFeatures, TpfVettingFeatures
from aurora_ml.pipeline.feature_checkpoint import (
    FeatureArtifactProgress,
    FeatureCheckpointRecord,
    FeatureCheckpointState,
    get_feature_checkpoint_key,
)
from aurora_ml.pipeline.features import LightCurveFeatures
from aurora_ml.pipeline.gold import GoldSnapshotManifest, GoldSnapshotPlan, SilverInputRef


class GoldMaterializeError(Exception):
    """Base exception for Gold materialization failures."""

    pass


class GoldArtifactConflictError(GoldMaterializeError):
    """Raised when an existing Gold artifact contains conflicting logical content."""

    pass


def get_candidate_arrow_schema() -> pa.Schema:
    """Explicit PyArrow schema for Candidate Gold dataset (gold-candidate-v1)."""
    return pa.schema(
        [
            # Identity
            ("source_product_id", pa.string()),
            ("lineage_id", pa.string()),
            ("sample_id", pa.string()),
            ("tic_id", pa.int64()),
            ("sector", pa.int32()),
            ("silver_sha256", pa.string()),
            ("lc_feature_version", pa.string()),
            ("lc_feature_fingerprint", pa.string()),
            # LC Model Inputs
            ("n_points", pa.int64()),
            ("time_span", pa.float64()),
            ("median_cadence", pa.float64()),
            ("max_gap", pa.float64()),
            ("flux_mean", pa.float64()),
            ("flux_median", pa.float64()),
            ("flux_std", pa.float64()),
            ("flux_mad", pa.float64()),
            ("flux_robust_sigma", pa.float64()),
            ("flux_amplitude", pa.float64()),
            ("flux_rms", pa.float64()),
            ("flux_skewness", pa.float64()),
            ("flux_kurtosis", pa.float64()),
            ("median_flux_err", pa.float64()),
            ("bls_available", pa.bool_()),
            ("bls_period", pa.float64()),
            ("bls_duration", pa.float64()),
            ("bls_transit_time", pa.float64()),
            ("bls_depth", pa.float64()),
            ("bls_power", pa.float64()),
            # TPF Model Inputs
            ("tpf_evidence_available", pa.bool_()),
            ("pixel_mad_median", pa.float64()),
            ("variability_peak_fraction", pa.float64()),
            ("transit_evidence_available", pa.bool_()),
            ("transit_deficit_sum", pa.float64()),
            ("transit_deficit_centroid_row", pa.float64()),
            ("transit_deficit_centroid_col", pa.float64()),
            ("transit_deficit_center_offset_pixels", pa.float64()),
            # TIC Model Inputs
            ("tic_available", pa.bool_()),
            ("tmag", pa.float64()),
            ("teff", pa.float64()),
            ("stellar_radius", pa.float64()),
            ("stellar_mass", pa.float64()),
            ("logg", pa.float64()),
            # Audit & Supervision
            ("matched_toi_id", pa.string()),
            ("toi_match_status", pa.string()),
            ("toi_period_error", pa.float64()),
            ("matched_tce_id", pa.string()),
            ("tce_match_status", pa.string()),
            ("training_label", pa.string()),
            ("label_policy_version", pa.string()),
        ]
    )


def get_lc_anomaly_arrow_schema() -> pa.Schema:
    """Explicit PyArrow schema for LC Anomaly dataset (gold-lightcurve-features-v1)."""
    return pa.schema(
        [
            ("lineage_id", pa.string()),
            ("source_product_id", pa.string()),
            ("product_kind", pa.string()),
            ("silver_schema_version", pa.string()),
            ("silver_sha256", pa.string()),
            ("processor_version", pa.string()),
            ("feature_version", pa.string()),
            ("feature_fingerprint", pa.string()),
            ("feature_status", pa.string()),
            ("sample_id", pa.string()),
            ("tic_id", pa.int64()),
            ("sector", pa.int32()),
            ("n_points", pa.int64()),
            ("time_min", pa.float64()),
            ("time_max", pa.float64()),
            ("time_span", pa.float64()),
            ("median_cadence", pa.float64()),
            ("max_gap", pa.float64()),
            ("flux_mean", pa.float64()),
            ("flux_median", pa.float64()),
            ("flux_std", pa.float64()),
            ("flux_mad", pa.float64()),
            ("flux_robust_sigma", pa.float64()),
            ("flux_amplitude", pa.float64()),
            ("flux_rms", pa.float64()),
            ("flux_skewness", pa.float64()),
            ("flux_kurtosis", pa.float64()),
            ("median_flux_err", pa.float64()),
            ("mean_flux_err", pa.float64()),
            ("bls_available", pa.bool_()),
            ("bls_period", pa.float64()),
            ("bls_duration", pa.float64()),
            ("bls_transit_time", pa.float64()),
            ("bls_depth", pa.float64()),
            ("bls_power", pa.float64()),
        ]
    )


def get_tpf_anomaly_arrow_schema() -> pa.Schema:
    """Explicit PyArrow schema for TPF Anomaly dataset (gold-tpf-vetting-v1)."""
    return pa.schema(
        [
            ("lineage_id", pa.string()),
            ("source_product_id", pa.string()),
            ("product_kind", pa.string()),
            ("silver_schema_version", pa.string()),
            ("silver_sha256", pa.string()),
            ("processor_version", pa.string()),
            ("tpf_feature_version", pa.string()),
            ("tpf_feature_fingerprint", pa.string()),
            ("tpf_feature_status", pa.string()),
            ("sample_id", pa.string()),
            ("tic_id", pa.int64()),
            ("sector", pa.int32()),
            ("n_cadences", pa.int64()),
            ("rows", pa.int32()),
            ("cols", pa.int32()),
            ("pixel_count", pa.int32()),
            ("finite_pixel_fraction", pa.float64()),
            ("pixel_mad_median", pa.float64()),
            ("pixel_mad_mean", pa.float64()),
            ("pixel_mad_max", pa.float64()),
            ("variability_peak_fraction", pa.float64()),
            ("variability_effective_pixels", pa.float64()),
            ("summed_flux_std", pa.float64()),
            ("summed_flux_mad", pa.float64()),
            ("summed_flux_p05", pa.float64()),
            ("summed_flux_p95", pa.float64()),
            ("transit_evidence_available", pa.bool_()),
            ("transit_in_cadences", pa.int32()),
            ("transit_out_cadences", pa.int32()),
            ("transit_deficit_sum", pa.float64()),
            ("transit_deficit_peak_fraction", pa.float64()),
            ("transit_deficit_effective_pixels", pa.float64()),
            ("transit_deficit_centroid_row", pa.float64()),
            ("transit_deficit_centroid_col", pa.float64()),
            ("transit_deficit_center_offset_pixels", pa.float64()),
        ]
    )


def get_ffi_anomaly_arrow_schema() -> pa.Schema:
    """Explicit PyArrow schema for FFI Anomaly dataset (gold-ffi-evidence-v1)."""
    return pa.schema(
        [
            ("lineage_id", pa.string()),
            ("source_product_id", pa.string()),
            ("sector", pa.int32()),
            ("camera", pa.int32()),
            ("ccd", pa.int32()),
            ("processor_version", pa.string()),
            ("silver_schema_version", pa.string()),
            ("silver_sha256", pa.string()),
            ("ffi_feature_version", pa.string()),
            ("ffi_feature_fingerprint", pa.string()),
            ("ffi_feature_status", pa.string()),
            ("ffi_width", pa.int32()),
            ("ffi_height", pa.int32()),
            ("ffi_finite_pixel_count", pa.int64()),
            ("ffi_finite_pixel_fraction", pa.float64()),
            ("ffi_median", pa.float64()),
            ("ffi_mean", pa.float64()),
            ("ffi_stddev", pa.float64()),
            ("ffi_min", pa.float64()),
            ("ffi_max", pa.float64()),
            ("ffi_dynamic_range", pa.float64()),
            ("cutout_evidence_available", pa.bool_()),
            ("cutout_count", pa.int32()),
            ("cutout_deviation_sum", pa.float64()),
            ("cutout_peak_deviation_fraction", pa.float64()),
            ("cutout_deviation_effective_pixels", pa.float64()),
            ("border_median", pa.float64()),
            ("border_mad", pa.float64()),
            ("center_deviation_fraction", pa.float64()),
        ]
    )


def derive_partition_content_sha256(
    dataset: str,
    sector: int,
    rows: List[Dict[str, Any]],
) -> str:
    """Compute canonical logical row content SHA-256 digest."""
    sorted_rows = sorted(
        rows,
        key=lambda r: (
            str(r.get("source_product_id", "")),
            str(r.get("sample_id", "") or ""),
        ),
    )
    canonical_obj = {
        "dataset": dataset,
        "sector": int(sector),
        "rows": sorted_rows,
    }
    canonical_json = json.dumps(canonical_obj, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()


def write_partition_parquet(
    schema: pa.Schema,
    rows: List[Dict[str, Any]],
    dest_path: str,
    dataset_name: str,
    sector: int,
    compression: str = "ZSTD",
) -> Tuple[int, str, str, int]:
    """Write local temporary Parquet file using explicit schema and ZSTD compression.

    Returns (row_count, content_sha256, parquet_sha256, size_bytes).
    """
    sorted_rows = sorted(
        rows,
        key=lambda r: (
            str(r.get("source_product_id", "")),
            str(r.get("sample_id", "") or ""),
        ),
    )

    content_sha256 = derive_partition_content_sha256(dataset_name, sector, sorted_rows)

    # Convert rows to columnar dict matching PyArrow schema types
    columns: Dict[str, List[Any]] = {field.name: [] for field in schema}

    for row in sorted_rows:
        for field in schema:
            val = row.get(field.name)
            # Type coercion and null handling
            if val is None or (isinstance(val, float) and not np.isfinite(val)):
                columns[field.name].append(None)
            elif field.type == pa.int64() or field.type == pa.int32():
                columns[field.name].append(int(val))
            elif field.type == pa.float64():
                columns[field.name].append(float(val))
            elif field.type == pa.bool_():
                columns[field.name].append(bool(val))
            else:
                columns[field.name].append(str(val))

    table = pa.Table.from_pydict(columns, schema=schema)

    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    pq.write_table(table, dest_path, compression=compression)

    size_bytes = os.path.getsize(dest_path)
    with open(dest_path, "rb") as f:
        parquet_sha256 = hashlib.sha256(f.read()).hexdigest()

    return len(sorted_rows), content_sha256, parquet_sha256, size_bytes


def format_sector_partition_path(snapshot_id: str, snapshot_type: str, dataset: str, sector: int) -> str:
    """Format canonical MinIO object key for a Gold partition."""
    sec_str = f"sector={sector:04d}"
    if snapshot_type.upper() == "CANDIDATE":
        return f"gold/snapshots/{snapshot_id}/data/candidate/{sec_str}/part-00000.parquet"
    else:
        return f"gold/snapshots/{snapshot_id}/data/anomaly/{dataset}/{sec_str}/part-00000.parquet"


def extract_sector_from_input_ref(inp: SilverInputRef) -> int:
    """Extract 1-indexed sector integer from SilverInputRef or sample_id."""
    if inp.sample_id and "s:" in inp.sample_id:
        parts = inp.sample_id.split(":")
        for idx, p in enumerate(parts):
            if p == "s" and idx + 1 < len(parts):
                try:
                    return int(parts[idx + 1])
                except ValueError:
                    pass
    if "sector=" in inp.silver_object_key:
        parts = inp.silver_object_key.split("sector=")
        if len(parts) > 1:
            sec_part = parts[1].split("/")[0]
            try:
                return int(sec_part)
            except ValueError:
                pass
    return 1


def group_inputs_by_sector(inputs: List[SilverInputRef]) -> Dict[int, List[SilverInputRef]]:
    """Group Silver inputs deterministically by sector."""
    grouped: Dict[int, List[SilverInputRef]] = {}
    for inp in inputs:
        sec = extract_sector_from_input_ref(inp)
        grouped.setdefault(sec, []).append(inp)
    return {k: grouped[k] for k in sorted(grouped.keys())}
