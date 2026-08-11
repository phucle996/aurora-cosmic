"""Target Pixel File Vetting & FFI Context Evidence Feature Extractor (tpf-vetting-v1, ffi-evidence-v1).

Transforms Silver TPF and Silver FFI products into deterministic spatial evidence records.
"""

from dataclasses import asdict, dataclass
import hashlib
import json
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

from aurora_ml.pipeline.features import LightCurveFeatures
from aurora_ml.pipeline.gold import SilverInputRef


def derive_tpf_feature_fingerprint(
    feature_version: str,
    window_factor: float,
    out_guard_factor: float,
    min_in_cadences: int,
    min_out_cadences: int,
    lc_dependency: Optional[str] = None,
) -> str:
    """Compute deterministic SHA-256 fingerprint for TPF scientific config."""
    canonical_obj = {
        "feature_version": feature_version,
        "lc_dependency": lc_dependency or "none",
        "min_in_cadences": int(min_in_cadences),
        "min_out_cadences": int(min_out_cadences),
        "out_guard_factor": float(out_guard_factor),
        "window_factor": float(window_factor),
    }
    canonical_json = json.dumps(canonical_obj, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()


def derive_ffi_feature_fingerprint(feature_version: str) -> str:
    """Compute deterministic SHA-256 fingerprint for FFI scientific config."""
    canonical_obj = {"feature_version": feature_version}
    canonical_json = json.dumps(canonical_obj, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()


@dataclass
class TpfVettingFeatures:
    """TPF vetting evidence record conforming to gold-tpf-vetting-v1.md."""

    # Identity & Provenance
    lineage_id: str
    source_product_id: str
    product_kind: str
    silver_schema_version: str
    silver_sha256: str
    processor_version: str
    tpf_feature_version: str
    tpf_feature_fingerprint: str
    tpf_feature_status: str
    sample_id: Optional[str] = None
    tic_id: Optional[int] = None
    sector: Optional[int] = None

    # TPF Shape & Data Quality
    n_cadences: int = 0
    rows: int = 0
    cols: int = 0
    pixel_count: int = 0
    finite_pixel_fraction: float = 1.0

    # Temporal Variability Summaries
    pixel_mad_median: float = 0.0
    pixel_mad_mean: float = 0.0
    pixel_mad_max: float = 0.0
    variability_peak_fraction: Optional[float] = None
    variability_effective_pixels: Optional[float] = None

    # Summed Relative Flux
    summed_flux_std: float = 0.0
    summed_flux_mad: float = 0.0
    summed_flux_p05: float = 0.0
    summed_flux_p95: float = 0.0

    # Candidate Transit Deficit Evidence
    transit_evidence_available: bool = False
    transit_in_cadences: Optional[int] = None
    transit_out_cadences: Optional[int] = None
    transit_deficit_sum: Optional[float] = None
    transit_deficit_peak_fraction: Optional[float] = None
    transit_deficit_effective_pixels: Optional[float] = None
    transit_deficit_centroid_row: Optional[float] = None
    transit_deficit_centroid_col: Optional[float] = None
    transit_deficit_center_offset_pixels: Optional[float] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class FfiEvidenceFeatures:
    """FFI context evidence record conforming to gold-ffi-evidence-v1.md."""

    # Identity & Provenance
    lineage_id: str
    source_product_id: str
    sector: int
    camera: int
    ccd: int
    processor_version: str
    silver_schema_version: str
    silver_sha256: str
    ffi_feature_version: str
    ffi_feature_fingerprint: str
    ffi_feature_status: str

    # Detector Summary Fields
    ffi_width: int
    ffi_height: int
    ffi_finite_pixel_count: int
    ffi_finite_pixel_fraction: float
    ffi_median: float
    ffi_mean: float
    ffi_stddev: float
    ffi_min: float
    ffi_max: float
    ffi_dynamic_range: float

    # Optional Cutout Evidence
    cutout_evidence_available: bool = False
    cutout_count: int = 0
    cutout_deviation_sum: Optional[float] = None
    cutout_peak_deviation_fraction: Optional[float] = None
    cutout_deviation_effective_pixels: Optional[float] = None
    border_median: Optional[float] = None
    border_mad: Optional[float] = None
    center_deviation_fraction: Optional[float] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def build_transit_masks(
    time_arr: np.ndarray,
    period: float,
    duration: float,
    transit_time: float,
    window_factor: float = 1.0,
    out_guard_factor: float = 2.0,
) -> Tuple[np.ndarray, np.ndarray]:
    """Build boolean masks for in-transit and guarded out-of-transit cadences."""
    time = np.asarray(time_arr, dtype=np.float64)
    # Calculate phase relative to nearest transit center
    phase = ((time - transit_time + period / 2.0) % period) - (period / 2.0)
    abs_phase = np.abs(phase)

    half_window = (window_factor * duration) / 2.0
    half_guard = (out_guard_factor * duration) / 2.0

    in_mask = abs_phase <= half_window
    out_mask = abs_phase >= half_guard

    return in_mask, out_mask


def compute_tpf_features(
    time_arr: np.ndarray,
    flux_cube_list: List[np.ndarray],
    rows: int,
    cols: int,
    metadata: Dict[str, Any],
    lc_features: Optional[LightCurveFeatures] = None,
    feature_version: str = "tpf-vetting-v1",
    window_factor: float = 1.0,
    out_guard_factor: float = 2.0,
    min_in_cadences: int = 3,
    min_out_cadences: int = 20,
) -> TpfVettingFeatures:
    """Pure mathematical function to extract TPF vetting evidence from time and flux cube."""
    time = np.asarray(time_arr, dtype=np.float64)
    n_cadences = len(time)

    if n_cadences == 0 or rows <= 0 or cols <= 0:
        raise ValueError("Invalid TPF input: empty cadences or non-positive dimensions")

    pixel_count = rows * cols

    # Reshape 1D flattened flux lists to (n_cadences, rows, cols)
    cube = np.zeros((n_cadences, rows, cols), dtype=np.float64)
    for t_idx in range(n_cadences):
        arr = np.asarray(flux_cube_list[t_idx], dtype=np.float64)
        if len(arr) != pixel_count:
            raise ValueError(
                f"Invalid TPF input: cadence {t_idx} array length {len(arr)} != rows*cols ({pixel_count})"
            )
        cube[t_idx] = arr.reshape((rows, cols))

    finite_mask = np.isfinite(cube)
    finite_pixel_fraction = float(np.mean(finite_mask))

    # Compute per-pixel temporal MAD map across cadences
    pixel_medians = np.median(cube, axis=0)  # Shape (rows, cols)
    pixel_mads = np.median(np.abs(cube - pixel_medians), axis=0)  # Shape (rows, cols)

    pixel_mad_median = float(np.median(pixel_mads))
    pixel_mad_mean = float(np.mean(pixel_mads))
    pixel_mad_max = float(np.max(pixel_mads))

    sum_mad = float(np.sum(pixel_mads))
    if sum_mad > 1e-12:
        variability_peak_fraction = float(pixel_mad_max / sum_mad)
        variability_effective_pixels = float((sum_mad**2) / np.sum(pixel_mads**2))
    else:
        variability_peak_fraction = None
        variability_effective_pixels = None

    # Summed relative flux across cadences
    summed_flux = np.sum(cube, axis=(1, 2))  # Shape (n_cadences,)
    summed_flux_std = float(np.std(summed_flux, ddof=0))
    summed_flux_mad = float(np.median(np.abs(summed_flux - np.median(summed_flux))))
    summed_flux_p05 = float(np.percentile(summed_flux, 5))
    summed_flux_p95 = float(np.percentile(summed_flux, 95))

    # Check Candidate Transit-Window Deficit Evidence
    transit_evidence_available = False
    transit_in_cadences = None
    transit_out_cadences = None
    transit_deficit_sum = None
    transit_deficit_peak_fraction = None
    transit_deficit_effective_pixels = None
    transit_deficit_centroid_row = None
    transit_deficit_centroid_col = None
    transit_deficit_center_offset_pixels = None
    tpf_feature_status = "SUCCESS"

    lc_dep_fingerprint = lc_features.feature_fingerprint if lc_features else None

    if lc_features is None:
        tpf_feature_status = "NO_PAIRED_LC"
    elif not lc_features.bls_available or lc_features.bls_period is None:
        tpf_feature_status = "NO_BLS_EPHEMERIS"
    else:
        # Validate candidate pairing compatibility
        sample_id = metadata.get("sample_id")
        lc_sample_id = lc_features.sample_id
        if sample_id and lc_sample_id and sample_id != lc_sample_id:
            tpf_feature_status = "PAIRING_CONFLICT"
        else:
            in_mask, out_mask = build_transit_masks(
                time_arr=time,
                period=lc_features.bls_period,
                duration=lc_features.bls_duration or 0.1,
                transit_time=lc_features.bls_transit_time or time[0],
                window_factor=window_factor,
                out_guard_factor=out_guard_factor,
            )

            n_in = int(np.sum(in_mask))
            n_out = int(np.sum(out_mask))

            transit_in_cadences = n_in
            transit_out_cadences = n_out

            if n_in < min_in_cadences or n_out < min_out_cadences:
                transit_evidence_available = False
                tpf_feature_status = "INSUFFICIENT_TRANSIT_CADENCES"
            else:
                transit_evidence_available = True

                # Median images during in-transit and out-of-transit windows
                in_median_img = np.median(cube[in_mask], axis=0)
                out_median_img = np.median(cube[out_mask], axis=0)

                # Positive Deficit Map: dimming during transit => out > in
                deficit_map = out_median_img - in_median_img
                positive_deficit = np.maximum(deficit_map, 0.0)

                tot_deficit = float(np.sum(positive_deficit))
                transit_deficit_sum = tot_deficit

                if tot_deficit > 1e-12:
                    transit_deficit_peak_fraction = float(
                        np.max(positive_deficit) / tot_deficit
                    )
                    transit_deficit_effective_pixels = float(
                        (tot_deficit**2) / np.sum(positive_deficit**2)
                    )

                    # Compute Transit Deficit Centroid (0-indexed)
                    grid_r, grid_c = np.indices((rows, cols))
                    c_row = float(np.sum(grid_r * positive_deficit) / tot_deficit)
                    c_col = float(np.sum(grid_c * positive_deficit) / tot_deficit)

                    transit_deficit_centroid_row = c_row
                    transit_deficit_centroid_col = c_col

                    # Offset from geometric cutout center
                    geom_center_r = (rows - 1) / 2.0
                    geom_center_c = (cols - 1) / 2.0
                    transit_deficit_center_offset_pixels = float(
                        np.sqrt(
                            (c_row - geom_center_r) ** 2 + (c_col - geom_center_c) ** 2
                        )
                    )

    fingerprint = derive_tpf_feature_fingerprint(
        feature_version=feature_version,
        window_factor=window_factor,
        out_guard_factor=out_guard_factor,
        min_in_cadences=min_in_cadences,
        min_out_cadences=min_out_cadences,
        lc_dependency=lc_dep_fingerprint,
    )

    return TpfVettingFeatures(
        lineage_id=metadata.get("lineage_id", ""),
        source_product_id=metadata.get("source_product_id", ""),
        product_kind=metadata.get("product_kind", "TARGET_PIXEL"),
        silver_schema_version=metadata.get(
            "silver_schema_version", "silver-target-pixel-v1"
        ),
        silver_sha256=metadata.get("silver_sha256", ""),
        processor_version=metadata.get("processor_version", ""),
        tpf_feature_version=feature_version,
        tpf_feature_fingerprint=fingerprint,
        tpf_feature_status=tpf_feature_status,
        sample_id=metadata.get("sample_id"),
        tic_id=metadata.get("tic_id"),
        sector=metadata.get("sector"),
        n_cadences=n_cadences,
        rows=rows,
        cols=cols,
        pixel_count=pixel_count,
        finite_pixel_fraction=finite_pixel_fraction,
        pixel_mad_median=pixel_mad_median,
        pixel_mad_mean=pixel_mad_mean,
        pixel_mad_max=pixel_mad_max,
        variability_peak_fraction=variability_peak_fraction,
        variability_effective_pixels=variability_effective_pixels,
        summed_flux_std=summed_flux_std,
        summed_flux_mad=summed_flux_mad,
        summed_flux_p05=summed_flux_p05,
        summed_flux_p95=summed_flux_p95,
        transit_evidence_available=transit_evidence_available,
        transit_in_cadences=transit_in_cadences,
        transit_out_cadences=transit_out_cadences,
        transit_deficit_sum=transit_deficit_sum,
        transit_deficit_peak_fraction=transit_deficit_peak_fraction,
        transit_deficit_effective_pixels=transit_deficit_effective_pixels,
        transit_deficit_centroid_row=transit_deficit_centroid_row,
        transit_deficit_centroid_col=transit_deficit_centroid_col,
        transit_deficit_center_offset_pixels=transit_deficit_center_offset_pixels,
    )


def compute_ffi_features(
    metadata: Dict[str, Any],
    summary_data: Dict[str, Any],
    cutouts: Optional[List[Dict[str, Any]]] = None,
    feature_version: str = "ffi-evidence-v1",
) -> FfiEvidenceFeatures:
    """Pure mathematical function to extract FFI context evidence."""
    width = int(summary_data.get("width", 2048))
    height = int(summary_data.get("height", 2048))
    finite_count = int(summary_data.get("finite_pixel_count", width * height))
    finite_fraction = float(summary_data.get("finite_pixel_fraction", 1.0))

    median_val = float(summary_data.get("median", 0.0))
    mean_val = float(summary_data.get("mean", 0.0))
    stddev_val = float(summary_data.get("stddev", 0.0))
    min_val = float(summary_data.get("min", 0.0))
    max_val = float(summary_data.get("max", 0.0))
    dynamic_range = float(max_val - min_val)

    fingerprint = derive_ffi_feature_fingerprint(feature_version=feature_version)

    cutout_evidence_available = False
    cutout_count = 0
    cutout_dev_sum = None
    cutout_peak_frac = None
    cutout_eff_pix = None
    border_med = None
    border_mad_val = None
    center_dev_frac = None
    ffi_feature_status = "SUCCESS"

    if cutouts and len(cutouts) > 0:
        cutout_evidence_available = True
        cutout_count = len(cutouts)

        c = cutouts[0]
        c_w = int(c.get("width", 0))
        c_h = int(c.get("height", 0))
        pixels = np.asarray(c.get("pixels", []), dtype=np.float64)

        if len(pixels) == c_w * c_h and c_w > 0 and c_h > 0:
            c_img = pixels.reshape((c_h, c_w))
            c_med = np.median(c_img)
            dev = np.abs(c_img - c_med)

            dev_sum = float(np.sum(dev))
            cutout_dev_sum = dev_sum

            if dev_sum > 1e-12:
                cutout_peak_frac = float(np.max(dev) / dev_sum)
                cutout_eff_pix = float((dev_sum**2) / np.sum(dev**2))

            if c_w >= 3 and c_h >= 3:
                # Border pixels (1-pixel outer boundary)
                border_mask = np.ones((c_h, c_w), dtype=bool)
                border_mask[1:-1, 1:-1] = False
                border_pix = c_img[border_mask]

                border_med = float(np.median(border_pix))
                border_mad_val = float(np.median(np.abs(border_pix - border_med)))

                # Central 3x3 region
                center_r = c_h // 2
                center_c = c_w // 2
                center_dev = dev[
                    center_r - 1 : center_r + 2, center_c - 1 : center_c + 2
                ]
                if dev_sum > 1e-12:
                    center_dev_frac = float(np.sum(center_dev) / dev_sum)
    else:
        cutout_evidence_available = False
        ffi_feature_status = "NO_CUTOUTS"

    return FfiEvidenceFeatures(
        lineage_id=metadata.get("lineage_id", ""),
        source_product_id=metadata.get("source_product_id", ""),
        sector=int(metadata.get("sector", 1)),
        camera=int(metadata.get("camera", 1)),
        ccd=int(metadata.get("ccd", 1)),
        processor_version=metadata.get("processor_version", ""),
        silver_schema_version=metadata.get("silver_schema_version", "silver-ffi-v1"),
        silver_sha256=metadata.get("silver_sha256", ""),
        ffi_feature_version=feature_version,
        ffi_feature_fingerprint=fingerprint,
        ffi_feature_status=ffi_feature_status,
        ffi_width=width,
        ffi_height=height,
        ffi_finite_pixel_count=finite_count,
        ffi_finite_pixel_fraction=finite_fraction,
        ffi_median=median_val,
        ffi_mean=mean_val,
        ffi_stddev=stddev_val,
        ffi_min=min_val,
        ffi_max=max_val,
        ffi_dynamic_range=dynamic_range,
        cutout_evidence_available=cutout_evidence_available,
        cutout_count=cutout_count,
        cutout_deviation_sum=cutout_dev_sum,
        cutout_peak_deviation_fraction=cutout_peak_frac,
        cutout_deviation_effective_pixels=cutout_eff_pix,
        border_median=border_med,
        border_mad=border_mad_val,
        center_deviation_fraction=center_dev_frac,
    )


def extract_tpf_features_from_silver(
    tpf_input_ref: SilverInputRef,
    time_arr: np.ndarray,
    flux_cube_list: List[np.ndarray],
    rows: int,
    cols: int,
    lc_features: Optional[LightCurveFeatures] = None,
    feature_version: str = "tpf-vetting-v1",
    window_factor: float = 1.0,
    out_guard_factor: float = 2.0,
) -> TpfVettingFeatures:
    """High-level extractor taking a SilverInputRef for TPF.

    Guarantees Silver-only input (0 reads from bronze/).
    """
    metadata = {
        "lineage_id": tpf_input_ref.lineage_id,
        "source_product_id": tpf_input_ref.source_product_id,
        "product_kind": tpf_input_ref.product_kind,
        "silver_schema_version": tpf_input_ref.silver_schema_version,
        "silver_sha256": tpf_input_ref.silver_sha256,
        "processor_version": tpf_input_ref.processor_version,
        "sample_id": tpf_input_ref.sample_id,
    }

    if tpf_input_ref.sample_id and tpf_input_ref.sample_id.startswith("tic:"):
        parts = tpf_input_ref.sample_id.split(":")
        if len(parts) >= 4:
            try:
                metadata["tic_id"] = int(parts[1])
                metadata["sector"] = int(parts[3])
            except ValueError:
                pass

    return compute_tpf_features(
        time_arr=time_arr,
        flux_cube_list=flux_cube_list,
        rows=rows,
        cols=cols,
        metadata=metadata,
        lc_features=lc_features,
        feature_version=feature_version,
        window_factor=window_factor,
        out_guard_factor=out_guard_factor,
    )


def extract_ffi_features_from_silver(
    ffi_input_ref: SilverInputRef,
    summary_data: Dict[str, Any],
    cutouts: Optional[List[Dict[str, Any]]] = None,
    feature_version: str = "ffi-evidence-v1",
) -> FfiEvidenceFeatures:
    """High-level extractor taking a SilverInputRef for FFI.

    Guarantees Silver-only input (0 reads from bronze/).
    """
    metadata = {
        "lineage_id": ffi_input_ref.lineage_id,
        "source_product_id": ffi_input_ref.source_product_id,
        "processor_version": ffi_input_ref.processor_version,
        "silver_schema_version": ffi_input_ref.silver_schema_version,
        "silver_sha256": ffi_input_ref.silver_sha256,
        "sector": 1,
        "camera": 1,
        "ccd": 1,
    }

    return compute_ffi_features(
        metadata=metadata,
        summary_data=summary_data,
        cutouts=cutouts,
        feature_version=feature_version,
    )
