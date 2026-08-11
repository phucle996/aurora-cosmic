"""Light Curve Scientific Feature Engineering Module (lc-features-v1).

Transforms Silver Light Curve time-series into deterministic scientific feature records.
"""

from dataclasses import asdict, dataclass
import hashlib
import json
from typing import Any, Dict, Optional

from astropy.timeseries import BoxLeastSquares
import numpy as np
from scipy import stats

from aurora_ml.pipeline.gold import SilverInputRef


def derive_feature_fingerprint(
    feature_version: str,
    bls_min_period_days: float,
    bls_max_period_days: float,
    bls_min_points: int,
) -> str:
    """Compute deterministic SHA-256 fingerprint for scientific feature config."""
    canonical_obj = {
        "bls_max_period_days": float(bls_max_period_days),
        "bls_min_period_days": float(bls_min_period_days),
        "bls_min_points": int(bls_min_points),
        "feature_version": feature_version,
    }
    canonical_json = json.dumps(canonical_obj, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()


@dataclass
class LightCurveFeatures:
    """Scientific feature record conforming to gold-lightcurve-features-v1.md."""

    # Identity & Provenance
    lineage_id: str
    source_product_id: str
    product_kind: str
    silver_schema_version: str
    silver_sha256: str
    processor_version: str
    feature_version: str
    feature_fingerprint: str
    feature_status: str  # SUCCESS, PARTIAL, INSUFFICIENT_BASELINE, INVALID_INPUT
    sample_id: Optional[str] = None
    tic_id: Optional[int] = None
    sector: Optional[int] = None

    # Time Coverage & Cadence
    n_points: int = 0
    time_min: float = 0.0
    time_max: float = 0.0
    time_span: float = 0.0
    median_cadence: float = 0.0
    max_gap: float = 0.0

    # Distribution & Robust Variability
    flux_mean: float = 0.0
    flux_median: float = 0.0
    flux_std: float = 0.0
    flux_mad: float = 0.0
    flux_robust_sigma: float = 0.0
    flux_amplitude: float = 0.0
    flux_rms: float = 0.0
    flux_skewness: Optional[float] = None
    flux_kurtosis: Optional[float] = None

    # Flux Error Summaries
    median_flux_err: Optional[float] = None
    mean_flux_err: Optional[float] = None

    # Astropy BLS Transit Search Evidence
    bls_available: bool = False
    bls_period: Optional[float] = None
    bls_duration: Optional[float] = None
    bls_transit_time: Optional[float] = None
    bls_depth: Optional[float] = None
    bls_power: Optional[float] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def compute_lightcurve_features(
    time_arr: np.ndarray,
    flux_arr: np.ndarray,
    flux_err_arr: Optional[np.ndarray],
    metadata: Dict[str, Any],
    feature_version: str = "lc-features-v1",
    bls_min_period_days: float = 0.5,
    bls_max_period_days: float = 20.0,
    bls_min_points: int = 100,
) -> LightCurveFeatures:
    """Pure mathematical function to extract LC scientific features from time/flux arrays.

    Does not perform MinIO I/O.
    """
    time = np.asarray(time_arr, dtype=np.float64)
    flux = np.asarray(flux_arr, dtype=np.float64)

    # 1. Validation of Silver input contract
    if len(time) == 0 or len(flux) == 0 or len(time) != len(flux):
        raise ValueError("Invalid Silver input: empty arrays or length mismatch")

    if not np.all(np.isfinite(time)) or not np.all(np.isfinite(flux)):
        raise ValueError("Invalid Silver input: non-finite values in time or flux")

    diff_t = np.diff(time)
    if np.any(diff_t <= 0):
        raise ValueError("Invalid Silver input: time array is not strictly increasing")

    fingerprint = derive_feature_fingerprint(
        feature_version=feature_version,
        bls_min_period_days=bls_min_period_days,
        bls_max_period_days=bls_max_period_days,
        bls_min_points=bls_min_points,
    )

    n_points = int(len(time))
    time_min = float(np.min(time))
    time_max = float(np.max(time))
    time_span = float(time_max - time_min)
    median_cadence = float(np.median(diff_t))
    max_gap = float(np.max(diff_t))

    # Distribution & Variability
    flux_mean = float(np.mean(flux))
    flux_median = float(np.median(flux))
    flux_std = float(np.std(flux, ddof=0))
    flux_mad = float(np.median(np.abs(flux - flux_median)))
    flux_robust_sigma = float(1.4826 * flux_mad)
    flux_amplitude = float(np.percentile(flux, 95) - np.percentile(flux, 5))
    flux_rms = float(np.sqrt(np.mean(flux**2)))

    # Skewness and Kurtosis (Fisher excess)
    if flux_std > 1e-12:
        flux_skewness = float(stats.skew(flux, bias=False))
        flux_kurtosis = float(stats.kurtosis(flux, fisher=True, bias=False))
    else:
        flux_skewness = None
        flux_kurtosis = None

    # Flux Error Summaries
    median_flux_err = None
    mean_flux_err = None
    if flux_err_arr is not None and len(flux_err_arr) == n_points:
        fe = np.asarray(flux_err_arr, dtype=np.float64)
        valid_fe = fe[np.isfinite(fe)]
        if len(valid_fe) > 0:
            median_flux_err = float(np.median(valid_fe))
            mean_flux_err = float(np.mean(valid_fe))

    # Astropy BLS Transit Search
    bls_available = False
    bls_period = None
    bls_duration = None
    bls_transit_time = None
    bls_depth = None
    bls_power = None
    feature_status = "SUCCESS"

    effective_max_period = min(bls_max_period_days, time_span / 2.0)

    if (
        n_points < bls_min_points
        or time_span < (bls_min_period_days * 2.0)
        or effective_max_period <= bls_min_period_days
    ):
        bls_available = False
        feature_status = "PARTIAL" if n_points >= 10 else "INSUFFICIENT_BASELINE"
    else:
        try:
            # Prepare BLS search model
            if median_flux_err is not None and median_flux_err > 0:
                bls_model = BoxLeastSquares(t=time, y=flux, dy=flux_err_arr)
            else:
                bls_model = BoxLeastSquares(t=time, y=flux)

            period_grid = np.linspace(
                bls_min_period_days, effective_max_period, num=1000
            )
            duration_grid = np.array([0.05, 0.1, 0.2, 0.4])  # days
            # Filter durations < period
            duration_grid = duration_grid[duration_grid < bls_min_period_days]
            if len(duration_grid) == 0:
                duration_grid = np.array([bls_min_period_days * 0.1])

            periodogram = bls_model.power(period_grid, duration_grid)
            best_idx = int(np.argmax(periodogram.power))

            bls_available = True
            bls_period = float(periodogram.period[best_idx])
            bls_duration = float(periodogram.duration[best_idx])
            bls_transit_time = float(periodogram.transit_time[best_idx])

            # Astropy depth convention can be signed or magnitude. Store positive depth magnitude.
            raw_depth = float(periodogram.depth[best_idx])
            bls_depth = abs(raw_depth)
            bls_power = float(periodogram.power[best_idx])
        except Exception:
            bls_available = False
            feature_status = "PARTIAL"

    return LightCurveFeatures(
        lineage_id=metadata.get("lineage_id", ""),
        source_product_id=metadata.get("source_product_id", ""),
        product_kind=metadata.get("product_kind", "LIGHT_CURVE"),
        silver_schema_version=metadata.get(
            "silver_schema_version", "silver-lightcurve-v1"
        ),
        silver_sha256=metadata.get("silver_sha256", ""),
        processor_version=metadata.get("processor_version", ""),
        feature_version=feature_version,
        feature_fingerprint=fingerprint,
        feature_status=feature_status,
        sample_id=metadata.get("sample_id"),
        tic_id=metadata.get("tic_id"),
        sector=metadata.get("sector"),
        n_points=n_points,
        time_min=time_min,
        time_max=time_max,
        time_span=time_span,
        median_cadence=median_cadence,
        max_gap=max_gap,
        flux_mean=flux_mean,
        flux_median=flux_median,
        flux_std=flux_std,
        flux_mad=flux_mad,
        flux_robust_sigma=flux_robust_sigma,
        flux_amplitude=flux_amplitude,
        flux_rms=flux_rms,
        flux_skewness=flux_skewness,
        flux_kurtosis=flux_kurtosis,
        median_flux_err=median_flux_err,
        mean_flux_err=mean_flux_err,
        bls_available=bls_available,
        bls_period=bls_period,
        bls_duration=bls_duration,
        bls_transit_time=bls_transit_time,
        bls_depth=bls_depth,
        bls_power=bls_power,
    )


def extract_features_from_silver(
    input_ref: SilverInputRef,
    time_arr: np.ndarray,
    flux_arr: np.ndarray,
    flux_err_arr: Optional[np.ndarray] = None,
    feature_version: str = "lc-features-v1",
    bls_min_period_days: float = 0.5,
    bls_max_period_days: float = 20.0,
    bls_min_points: int = 100,
) -> LightCurveFeatures:
    """High-level extractor taking a SilverInputRef and numeric arrays.

    Guarantees Silver-only input (0 reads from bronze/).
    """
    metadata = {
        "lineage_id": input_ref.lineage_id,
        "source_product_id": input_ref.source_product_id,
        "product_kind": input_ref.product_kind,
        "silver_schema_version": input_ref.silver_schema_version,
        "silver_sha256": input_ref.silver_sha256,
        "processor_version": input_ref.processor_version,
        "sample_id": input_ref.sample_id,
    }

    # Parse tic_id and sector from sample_id if available (e.g. "tic:12345678:s:1")
    if input_ref.sample_id and input_ref.sample_id.startswith("tic:"):
        parts = input_ref.sample_id.split(":")
        if len(parts) >= 4:
            try:
                metadata["tic_id"] = int(parts[1])
                metadata["sector"] = int(parts[3])
            except ValueError:
                pass

    return compute_lightcurve_features(
        time_arr=time_arr,
        flux_arr=flux_arr,
        flux_err_arr=flux_err_arr,
        metadata=metadata,
        feature_version=feature_version,
        bls_min_period_days=bls_min_period_days,
        bls_max_period_days=bls_max_period_days,
        bls_min_points=bls_min_points,
    )
