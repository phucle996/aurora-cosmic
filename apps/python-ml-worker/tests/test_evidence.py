"""Unit & integration tests for TPF & FFI Vetting Evidence (tpf-vetting-v1, ffi-evidence-v1)."""

import numpy as np
import pytest

from aurora_ml.evidence import (
    FfiEvidenceFeatures,
    TpfVettingFeatures,
    build_transit_masks,
    compute_ffi_features,
    compute_tpf_features,
    derive_ffi_feature_fingerprint,
    derive_tpf_feature_fingerprint,
    extract_ffi_features_from_silver,
    extract_tpf_features_from_silver,
)
from aurora_ml.features import LightCurveFeatures
from aurora_ml.gold import SilverInputRef


def sample_tpf_ref() -> SilverInputRef:
    return SilverInputRef(
        lineage_id="b9f2c8d1928014819030",
        source_product_id="tess-tp-12345678-s0001-0120",
        product_kind="TARGET_PIXEL",
        silver_bucket="aurora-silver",
        silver_object_key="silver/tess/target-pixel/processor=tpf-preprocess-v1/sector=0001/tic=12345678/tp1.parquet",
        silver_sha256="e8ca4238a0b923820dcc509a6f75849d",
        silver_schema_version="silver-target-pixel-v1",
        processor_version="tpf-preprocess-v1",
        sample_id="tic:12345678:s:1",
    )


def sample_ffi_ref() -> SilverInputRef:
    return SilverInputRef(
        lineage_id="c7f2c8d1928014819031",
        source_product_id="tess-ffi-s0001-c1-ccd1",
        product_kind="FFI",
        silver_bucket="aurora-silver",
        silver_object_key="silver/tess/ffi/processor=ffi-preprocess-v1/sector=0001/camera=1/ccd=1/ffi1.parquet",
        silver_sha256="f9ca4238a0b923820dcc509a6f75849e",
        silver_schema_version="silver-ffi-v1",
        processor_version="ffi-preprocess-v1",
    )


def sample_lc_features() -> LightCurveFeatures:
    return LightCurveFeatures(
        lineage_id="a3f2c8d1928014819028",
        source_product_id="tess-lc-12345678-s0001-0120",
        product_kind="LIGHT_CURVE",
        silver_schema_version="silver-lightcurve-v1",
        silver_sha256="c4ca4238a0b923820dcc509a6f75849b",
        processor_version="lc-preprocess-v1",
        feature_version="lc-features-v1",
        feature_fingerprint="lc_fp_12345",
        feature_status="SUCCESS",
        sample_id="tic:12345678:s:1",
        tic_id=12345678,
        sector=1,
        bls_available=True,
        bls_period=3.5,
        bls_duration=0.2,
        bls_transit_time=1.0,
        bls_depth=0.01,
        bls_power=0.9,
    )


def test_tpf_shape_and_flattening():
    time = np.linspace(0, 10, 50)
    rows, cols = 3, 3
    pixel_count = rows * cols

    # Synthetic cube: flattened 1D array per cadence
    flux_cube = [np.arange(pixel_count, dtype=np.float64) for _ in range(50)]

    res = compute_tpf_features(
        time_arr=time,
        flux_cube_list=flux_cube,
        rows=rows,
        cols=cols,
        metadata={"lineage_id": "test_shape"},
    )

    assert res.n_cadences == 50
    assert res.rows == 3
    assert res.cols == 3
    assert res.pixel_count == 9
    assert res.finite_pixel_fraction == 1.0


def test_tpf_constant_cube():
    time = np.linspace(0, 10, 50)
    rows, cols = 3, 3
    flux_cube = [np.zeros(9, dtype=np.float64) for _ in range(50)]

    res = compute_tpf_features(
        time_arr=time,
        flux_cube_list=flux_cube,
        rows=rows,
        cols=cols,
        metadata={"lineage_id": "test_const_tpf"},
    )

    assert res.pixel_mad_median == 0.0
    assert res.pixel_mad_mean == 0.0
    assert res.pixel_mad_max == 0.0
    assert res.variability_peak_fraction is None
    assert res.variability_effective_pixels is None


def test_tpf_spatial_variability():
    time = np.linspace(0, 10, 100)
    rows, cols = 3, 3

    # Cube where only pixel 0 varies strongly
    flux_cube_single = []
    for t_val in time:
        arr = np.zeros(9, dtype=np.float64)
        arr[0] = np.sin(t_val)  # Only top-left pixel varies
        flux_cube_single.append(arr)

    res_single = compute_tpf_features(
        time_arr=time,
        flux_cube_list=flux_cube_single,
        rows=rows,
        cols=cols,
        metadata={},
    )

    assert res_single.variability_peak_fraction is not None
    assert res_single.variability_peak_fraction > 0.8  # Highly concentrated
    assert res_single.variability_effective_pixels is not None
    assert pytest.approx(res_single.variability_effective_pixels, abs=0.5) == 1.0


def test_transit_mask_building():
    time = np.linspace(0, 10, 100)
    period = 4.0
    duration = 0.4
    transit_time = 2.0

    in_mask, out_mask = build_transit_masks(
        time_arr=time,
        period=period,
        duration=duration,
        transit_time=transit_time,
        window_factor=1.0,
        out_guard_factor=2.0,
    )

    assert np.sum(in_mask) > 0
    assert np.sum(out_mask) > 0
    # In-transit and out-of-transit masks must be mutually exclusive
    assert not np.any(in_mask & out_mask)


def test_tpf_injected_central_transit():
    """Inject a dip concentrated at center pixel (1, 1) of 3x3 grid."""
    np.random.seed(42)
    time = np.linspace(0, 20, 400)
    rows, cols = 3, 3
    center_idx = 4  # (row 1, col 1)

    period = 4.0
    duration = 0.3
    transit_time = 2.0

    flux_cube = []
    for t_val in time:
        arr = np.zeros(9, dtype=np.float64)
        phase = ((t_val - transit_time + period / 2.0) % period) - (period / 2.0)
        if abs(phase) <= (duration / 2.0):
            arr[center_idx] = -0.05  # 5% dip at center
        flux_cube.append(arr)

    lc_feat = LightCurveFeatures(
        lineage_id="lc_1",
        source_product_id="lc_prod_1",
        product_kind="LIGHT_CURVE",
        silver_schema_version="silver-lightcurve-v1",
        silver_sha256="sha",
        processor_version="lc-preprocess-v1",
        feature_version="lc-features-v1",
        feature_fingerprint="fp123",
        feature_status="SUCCESS",
        sample_id="tic:12345:s:1",
        bls_available=True,
        bls_period=period,
        bls_duration=duration,
        bls_transit_time=transit_time,
        bls_depth=0.05,
        bls_power=0.95,
    )

    res = compute_tpf_features(
        time_arr=time,
        flux_cube_list=flux_cube,
        rows=rows,
        cols=cols,
        metadata={"sample_id": "tic:12345:s:1"},
        lc_features=lc_feat,
    )

    assert res.transit_evidence_available is True
    assert res.transit_deficit_sum is not None and res.transit_deficit_sum > 0
    assert res.transit_deficit_centroid_row is not None
    assert pytest.approx(res.transit_deficit_centroid_row, abs=0.1) == 1.0
    assert pytest.approx(res.transit_deficit_centroid_col, abs=0.1) == 1.0
    assert res.transit_deficit_center_offset_pixels is not None
    assert pytest.approx(res.transit_deficit_center_offset_pixels, abs=0.1) == 0.0


def test_tpf_off_center_dip():
    """Inject dip at top-left edge pixel (0, 0) of 3x3 grid."""
    time = np.linspace(0, 20, 400)
    rows, cols = 3, 3
    edge_idx = 0  # (row 0, col 0)

    period = 4.0
    duration = 0.3
    transit_time = 2.0

    flux_cube = []
    for t_val in time:
        arr = np.zeros(9, dtype=np.float64)
        phase = ((t_val - transit_time + period / 2.0) % period) - (period / 2.0)
        if abs(phase) <= (duration / 2.0):
            arr[edge_idx] = -0.05
        flux_cube.append(arr)

    lc_feat = sample_lc_features()
    lc_feat.bls_period = period
    lc_feat.bls_duration = duration
    lc_feat.bls_transit_time = transit_time

    res = compute_tpf_features(
        time_arr=time,
        flux_cube_list=flux_cube,
        rows=rows,
        cols=cols,
        metadata={"sample_id": lc_feat.sample_id},
        lc_features=lc_feat,
    )

    assert res.transit_evidence_available is True
    assert pytest.approx(res.transit_deficit_centroid_row, abs=0.1) == 0.0
    assert pytest.approx(res.transit_deficit_centroid_col, abs=0.1) == 0.0
    assert res.transit_deficit_center_offset_pixels > 1.0  # Off-center offset


def test_tpf_no_paired_lc():
    time = np.linspace(0, 10, 50)
    flux_cube = [np.zeros(9) for _ in range(50)]

    res = compute_tpf_features(
        time_arr=time,
        flux_cube_list=flux_cube,
        rows=3,
        cols=3,
        metadata={"lineage_id": "test_no_lc"},
        lc_features=None,
    )

    assert res.transit_evidence_available is False
    assert res.tpf_feature_status == "NO_PAIRED_LC"
    assert res.transit_deficit_sum is None


def test_tpf_pairing_conflict():
    time = np.linspace(0, 10, 50)
    flux_cube = [np.zeros(9) for _ in range(50)]
    lc_feat = sample_lc_features()
    lc_feat.sample_id = "tic:99999999:s:1"  # Different sample_id

    res = compute_tpf_features(
        time_arr=time,
        flux_cube_list=flux_cube,
        rows=3,
        cols=3,
        metadata={"sample_id": "tic:12345678:s:1"},
        lc_features=lc_feat,
    )

    assert res.transit_evidence_available is False
    assert res.tpf_feature_status == "PAIRING_CONFLICT"


def test_ffi_summary_features():
    summary_data = {
        "width": 2048,
        "height": 2048,
        "finite_pixel_count": 4194304,
        "finite_pixel_fraction": 1.0,
        "median": 1200.0,
        "mean": 1210.0,
        "stddev": 150.0,
        "min": 100.0,
        "max": 65000.0,
    }

    res = compute_ffi_features(
        metadata={"lineage_id": "ffi_1", "sector": 1, "camera": 1, "ccd": 1},
        summary_data=summary_data,
        cutouts=None,
    )

    assert res.ffi_width == 2048
    assert res.ffi_height == 2048
    assert res.ffi_finite_pixel_fraction == 1.0
    assert res.ffi_dynamic_range == 64900.0
    assert res.cutout_evidence_available is False
    assert res.ffi_feature_status == "NO_CUTOUTS"


def test_ffi_cutouts():
    summary_data = {"width": 2048, "height": 2048, "min": 0.0, "max": 100.0}
    # Synthetic 3x3 cutout with large central value
    cutouts = [
        {
            "width": 3,
            "height": 3,
            "pixels": [0.0, 0.0, 0.0, 0.0, 10.0, 0.0, 0.0, 0.0, 0.0],
        }
    ]

    res = compute_ffi_features(
        metadata={"lineage_id": "ffi_cutout", "sector": 1, "camera": 1, "ccd": 1},
        summary_data=summary_data,
        cutouts=cutouts,
    )

    assert res.cutout_evidence_available is True
    assert res.cutout_count == 1
    assert res.cutout_deviation_sum is not None and res.cutout_deviation_sum > 0
    assert res.border_median == 0.0
    assert res.center_deviation_fraction == pytest.approx(1.0, abs=1e-5)


def test_fingerprint_determinism_and_stability():
    fp_tpf1 = derive_tpf_feature_fingerprint("tpf-vetting-v1", 1.0, 2.0, 3, 20)
    fp_tpf2 = derive_tpf_feature_fingerprint("tpf-vetting-v1", 1.0, 2.0, 3, 20)
    assert fp_tpf1 == fp_tpf2
    assert len(fp_tpf1) == 64

    fp_ffi1 = derive_ffi_feature_fingerprint("ffi-evidence-v1")
    fp_ffi2 = derive_ffi_feature_fingerprint("ffi-evidence-v1")
    assert fp_ffi1 == fp_ffi2
    assert len(fp_ffi1) == 64


def test_bronze_raw_deleted_safety():
    """Verify that extract_tpf_features_from_silver and extract_ffi_features_from_silver run with zero reads to bronze/."""
    tpf_ref = sample_tpf_ref()
    ffi_ref = sample_ffi_ref()

    time = np.linspace(0, 10, 50)
    flux_cube = [np.zeros(9) for _ in range(50)]

    tpf_res = extract_tpf_features_from_silver(
        tpf_input_ref=tpf_ref,
        time_arr=time,
        flux_cube_list=flux_cube,
        rows=3,
        cols=3,
    )

    assert tpf_res.lineage_id == tpf_ref.lineage_id
    assert tpf_res.source_product_id == tpf_ref.source_product_id
    assert tpf_res.tpf_feature_version == "tpf-vetting-v1"

    ffi_res = extract_ffi_features_from_silver(
        ffi_input_ref=ffi_ref,
        summary_data={"width": 2048, "height": 2048, "min": 0.0, "max": 1000.0},
    )

    assert ffi_res.lineage_id == ffi_ref.lineage_id
    assert ffi_res.source_product_id == ffi_ref.source_product_id
    assert ffi_res.ffi_feature_version == "ffi-evidence-v1"
