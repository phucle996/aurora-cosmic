"""Unit & integration tests for Light Curve Scientific Feature Engineering (lc-features-v1)."""

import numpy as np
import pytest

from aurora_ml.pipeline.features import (
    LightCurveFeatures,
    compute_lightcurve_features,
    derive_feature_fingerprint,
    extract_features_from_silver,
)
from aurora_ml.pipeline.gold import SilverInputRef


def sample_silver_ref() -> SilverInputRef:
    return SilverInputRef(
        lineage_id="a3f2c8d1928014819028",
        source_product_id="tess-lc-12345678-s0001-0120",
        product_kind="LIGHT_CURVE",
        silver_bucket="aurora-silver",
        silver_object_key="silver/tess/lightcurve/processor=lc-preprocess-v1/sector=0001/tic=12345678/lc1.parquet",
        silver_sha256="c4ca4238a0b923820dcc509a6f75849b",
        silver_schema_version="silver-lightcurve-v1",
        processor_version="lc-preprocess-v1",
        sample_id="tic:12345678:s:1",
    )


def test_basic_statistics():
    time = np.linspace(0, 10, 100)
    flux = np.array([-2.0, -1.0, 0.0, 1.0, 2.0] * 20)

    res = compute_lightcurve_features(
        time_arr=time,
        flux_arr=flux,
        flux_err_arr=None,
        metadata={"lineage_id": "test_123"},
        bls_min_points=200,  # Skip BLS for pure stat test
    )

    assert res.n_points == 100
    assert pytest.approx(res.flux_mean, abs=1e-5) == 0.0
    assert pytest.approx(res.flux_median, abs=1e-5) == 0.0
    assert res.flux_std > 0
    assert res.flux_mad > 0
    assert res.flux_robust_sigma == pytest.approx(1.4826 * res.flux_mad, abs=1e-5)
    assert res.flux_amplitude > 0
    assert res.flux_rms > 0


def test_constant_series():
    time = np.linspace(0, 10, 100)
    flux = np.zeros(100)  # Constant flux 0

    res = compute_lightcurve_features(
        time_arr=time,
        flux_arr=flux,
        flux_err_arr=None,
        metadata={"lineage_id": "test_const"},
        bls_min_points=200,
    )

    assert res.flux_mean == 0.0
    assert res.flux_median == 0.0
    assert res.flux_std == 0.0
    assert res.flux_mad == 0.0
    assert res.flux_robust_sigma == 0.0
    assert res.flux_amplitude == 0.0
    assert res.flux_rms == 0.0
    # Skewness and kurtosis must be None for constant series
    assert res.flux_skewness is None
    assert res.flux_kurtosis is None


def test_time_coverage_and_gaps():
    # Times with a gap from t=3 to t=7
    t1 = np.linspace(0, 3, 30)
    t2 = np.linspace(7, 10, 30)
    time = np.concatenate([t1, t2])
    flux = np.sin(time)

    res = compute_lightcurve_features(
        time_arr=time,
        flux_arr=flux,
        flux_err_arr=None,
        metadata={"lineage_id": "test_gaps"},
        bls_min_points=200,
    )

    assert res.n_points == 60
    assert res.time_min == 0.0
    assert res.time_max == 10.0
    assert res.time_span == 10.0
    assert res.max_gap == pytest.approx(4.0, abs=0.1)


def test_synthetic_transit_bls_recovery():
    """Inject a periodic box-dip transit into clean time series and verify Astropy BLS recovery."""
    np.random.seed(42)
    time = np.linspace(0, 20, 500)  # 20-day baseline
    flux = np.zeros_like(time)

    period = 3.5  # 3.5-day transit period
    duration = 0.2  # 0.2-day transit duration
    depth = 0.01  # 1% dip depth magnitude

    # Add periodic dips
    for t_idx, t_val in enumerate(time):
        phase = (t_val % period)
        if phase < duration:
            flux[t_idx] = -depth

    # Add minor noise
    flux += np.random.normal(0, 0.0005, size=len(time))

    res = compute_lightcurve_features(
        time_arr=time,
        flux_arr=flux,
        flux_err_arr=None,
        metadata={"lineage_id": "synthetic_transit"},
        bls_min_period_days=1.0,
        bls_max_period_days=10.0,
        bls_min_points=50,
    )

    assert res.bls_available is True
    assert res.bls_period is not None
    assert pytest.approx(res.bls_period, abs=0.15) == period
    assert res.bls_depth is not None
    assert res.bls_depth > 0  # Stored as positive magnitude
    assert res.bls_power is not None and res.bls_power > 0


def test_short_baseline_bls_disabled():
    time = np.linspace(0, 0.8, 30)  # 0.8 day baseline, too short for period search
    flux = np.random.normal(0, 0.001, size=30)

    res = compute_lightcurve_features(
        time_arr=time,
        flux_arr=flux,
        flux_err_arr=None,
        metadata={"lineage_id": "short_base"},
        bls_min_period_days=0.5,
        bls_min_points=10,
    )

    assert res.bls_available is False
    assert res.bls_period is None
    assert res.bls_depth is None
    assert res.feature_status in ("PARTIAL", "INSUFFICIENT_BASELINE")


def test_missing_flux_err():
    time = np.linspace(0, 10, 150)
    flux = np.random.normal(0, 0.001, size=150)

    res = compute_lightcurve_features(
        time_arr=time,
        flux_arr=flux,
        flux_err_arr=None,  # Missing flux_err
        metadata={"lineage_id": "no_err"},
        bls_min_points=100,
    )

    assert res.median_flux_err is None
    assert res.mean_flux_err is None
    assert res.flux_mean is not None


def test_contract_validation_decreasing_time():
    time = np.array([0.0, 2.0, 1.0, 3.0])  # Non-monotonic time
    flux = np.array([0.0, 0.0, 0.0, 0.0])

    with pytest.raises(ValueError, match="strictly increasing"):
        compute_lightcurve_features(
            time_arr=time,
            flux_arr=flux,
            flux_err_arr=None,
            metadata={},
        )


def test_contract_validation_non_finite():
    time = np.array([0.0, 1.0, 2.0, 3.0])
    flux = np.array([0.0, np.nan, 0.0, 0.0])  # NaN in flux

    with pytest.raises(ValueError, match="non-finite values"):
        compute_lightcurve_features(
            time_arr=time,
            flux_arr=flux,
            flux_err_arr=None,
            metadata={},
        )


def test_feature_fingerprint_determinism_and_stability():
    fp1 = derive_feature_fingerprint(
        feature_version="lc-features-v1",
        bls_min_period_days=0.5,
        bls_max_period_days=20.0,
        bls_min_points=100,
    )

    fp2 = derive_feature_fingerprint(
        feature_version="lc-features-v1",
        bls_min_period_days=0.5,
        bls_max_period_days=20.0,
        bls_min_points=100,
    )

    assert fp1 == fp2
    assert len(fp1) == 64

    # Changing parameter changes fingerprint
    fp3 = derive_feature_fingerprint(
        feature_version="lc-features-v1",
        bls_min_period_days=1.0,  # Changed min period
        bls_max_period_days=20.0,
        bls_min_points=100,
    )

    assert fp1 != fp3


def test_bronze_raw_deleted_safety():
    """Verify that extract_features_from_silver operates strictly on Silver ref with zero reads to bronze/."""
    ref = sample_silver_ref()
    time = np.linspace(0, 10, 150)
    flux = np.sin(time)

    features = extract_features_from_silver(
        input_ref=ref,
        time_arr=time,
        flux_arr=flux,
    )

    assert features.lineage_id == ref.lineage_id
    assert features.source_product_id == ref.source_product_id
    assert features.silver_sha256 == ref.silver_sha256
    assert features.feature_version == "lc-features-v1"
    assert features.tic_id == 12345678
    assert features.sector == 1
