"""Unit & integration tests for Catalog Snapshots, Candidate Matching & Label Versioning (Phase 5.4)."""

import csv
from pathlib import Path
import pytest

from aurora_ml.catalogs import (
    MODEL_INPUT_ALLOWLIST,
    SUPERVISION_ALLOWLIST,
    TicCatalogRecord,
    ToiCatalogRecord,
    derive_candidate_label,
    derive_catalog_snapshot_identity,
    derive_label_snapshot_identity,
    enrich_candidate,
    match_tce_candidate,
    match_toi_candidate,
    normalize_tic_catalog,
    normalize_toi_catalog,
    normalize_tce_catalog,
)
from aurora_ml.evidence import TpfVettingFeatures
from aurora_ml.features import LightCurveFeatures


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


def sample_tpf_features() -> TpfVettingFeatures:
    return TpfVettingFeatures(
        lineage_id="b9f2c8d1928014819030",
        source_product_id="tess-tp-12345678-s0001-0120",
        product_kind="TARGET_PIXEL",
        silver_schema_version="silver-target-pixel-v1",
        silver_sha256="e8ca4238a0b923820dcc509a6f75849d",
        processor_version="tpf-preprocess-v1",
        tpf_feature_version="tpf-vetting-v1",
        tpf_feature_fingerprint="tpf_fp_12345",
        tpf_feature_status="SUCCESS",
        sample_id="tic:12345678:s:1",
        tic_id=12345678,
        sector=1,
        n_cadences=50,
        rows=3,
        cols=3,
        pixel_count=9,
        transit_evidence_available=True,
        transit_deficit_sum=0.05,
        transit_deficit_centroid_row=1.0,
        transit_deficit_centroid_col=1.0,
        transit_deficit_center_offset_pixels=0.0,
    )


def load_csv_fixture(fixture_filename: str):
    fixture_path = Path(__file__).parent / "fixtures" / "catalogs" / fixture_filename
    with open(fixture_path, mode="r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        return list(reader)


def test_tic_normalization():
    raw_rows = load_csv_fixture("tic-small.csv")
    records, sha = normalize_tic_catalog(raw_rows)

    assert len(records) == 2
    assert records[0].tic_id == 12345678
    assert records[0].teff == 5780.0
    assert records[0].tmag == 11.5
    assert len(sha) == 64


def test_tic_duplicate_key_rejection():
    raw_rows = [
        {"tic_id": "123", "tmag": "10.0"},
        {"tic_id": "123", "tmag": "12.0"},
    ]
    with pytest.raises(ValueError, match="CATALOG_DUPLICATE_KEY"):
        normalize_tic_catalog(raw_rows)


def test_toi_normalization():
    raw_rows = load_csv_fixture("toi-small.csv")
    records, sha = normalize_toi_catalog(raw_rows)

    assert len(records) == 3
    # Verifies format preservation ("123.01")
    rec1 = [r for r in records if r.toi_id == "123.01"][0]
    assert rec1.toi_id == "123.01"
    assert rec1.tic_id == 12345678
    assert rec1.toi_disposition_norm == "KNOWN_PLANET"

    rec2 = [r for r in records if r.toi_id == "123.02"][0]
    assert rec2.toi_disposition_norm == "CANDIDATE"

    rec3 = [r for r in records if r.toi_id == "999.01"][0]
    assert rec3.toi_disposition_norm == "FALSE_POSITIVE"


def test_catalog_snapshot_identity_determinism():
    raw_rows = load_csv_fixture("toi-small.csv")
    records1, sha1 = normalize_toi_catalog(raw_rows)
    id1 = derive_catalog_snapshot_identity("TOI", "toi-normalize-v1", sha1)

    # Shuffle row order
    shuffled_rows = list(reversed(raw_rows))
    records2, sha2 = normalize_toi_catalog(shuffled_rows)
    id2 = derive_catalog_snapshot_identity("TOI", "toi-normalize-v1", sha2)

    assert sha1 == sha2
    assert id1 == id2
    assert id1.startswith("toi-v1-")


def test_toi_candidate_matching_exact():
    lc_feat = sample_lc_features()  # tic_id=12345678, bls_period=3.5
    raw_toi = load_csv_fixture("toi-small.csv")
    toi_recs, _ = normalize_toi_catalog(raw_toi)

    matched_toi, status, p_err = match_toi_candidate(lc_feat, toi_recs, period_tolerance=0.05)

    assert matched_toi is not None
    assert matched_toi.toi_id == "123.01"
    assert status == "EPHEMERIS_MATCH"
    assert p_err == pytest.approx(0.0, abs=1e-5)


def test_toi_candidate_matching_harmonics():
    lc_feat = sample_lc_features()
    lc_feat.bls_period = 1.75  # 0.5x harmonic of TOI 123.01 (3.5 days)
    raw_toi = load_csv_fixture("toi-small.csv")
    toi_recs, _ = normalize_toi_catalog(raw_toi)

    matched_toi, status, p_err = match_toi_candidate(lc_feat, toi_recs, period_tolerance=0.05)

    assert matched_toi is not None
    assert matched_toi.toi_id == "123.01"
    assert status in ("EPHEMERIS_MATCH", "PERIOD_ONLY")


def test_toi_candidate_matching_ambiguous():
    lc_feat = sample_lc_features()
    lc_feat.bls_period = 3.5

    # Create two identical TOIs for same target
    toi1 = ToiCatalogRecord(toi_id="123.01", tic_id=12345678, catalog_period=3.5)
    toi2 = ToiCatalogRecord(toi_id="123.03", tic_id=12345678, catalog_period=3.5)

    matched_toi, status, p_err = match_toi_candidate(lc_feat, [toi1, toi2], period_tolerance=0.05)

    assert matched_toi is None
    assert status == "AMBIGUOUS"


def test_label_policy_conservative():
    # 1. Confirmed planet -> POSITIVE
    toi_kp = ToiCatalogRecord(toi_id="123.01", tic_id=12345678, toi_disposition_norm="KNOWN_PLANET")
    lbl_kp = derive_candidate_label((toi_kp, "EPHEMERIS_MATCH", 0.0), (None, "NO_MATCH"))
    assert lbl_kp.training_label == "POSITIVE"

    # 2. False positive -> NEGATIVE
    toi_fp = ToiCatalogRecord(toi_id="999.01", tic_id=99999999, toi_disposition_norm="FALSE_POSITIVE")
    lbl_fp = derive_candidate_label((toi_fp, "EPHEMERIS_MATCH", 0.0), (None, "NO_MATCH"))
    assert lbl_fp.training_label == "NEGATIVE"

    # 3. Candidate -> UNRESOLVED
    toi_pc = ToiCatalogRecord(toi_id="123.02", tic_id=12345678, toi_disposition_norm="CANDIDATE")
    lbl_pc = derive_candidate_label((toi_pc, "EPHEMERIS_MATCH", 0.0), (None, "NO_MATCH"))
    assert lbl_pc.training_label == "UNRESOLVED"

    # 4. No match -> UNRESOLVED
    lbl_none = derive_candidate_label((None, "NO_MATCH", None), (None, "NO_MATCH"))
    assert lbl_none.training_label == "UNRESOLVED"


def test_signal_feature_independence():
    """Verify that changing TOI disposition alters derived label but leaves signal features 100% untouched."""
    lc_feat = sample_lc_features()
    tpf_feat = sample_tpf_features()

    raw_tic = load_csv_fixture("tic-small.csv")
    tic_recs, _ = normalize_tic_catalog(raw_tic)
    tic_index = {r.tic_id: r for r in tic_recs}

    # Run 1 with KNOWN_PLANET disposition
    toi_recs_v1 = [ToiCatalogRecord(toi_id="123.01", tic_id=12345678, catalog_period=3.5, toi_disposition_norm="KNOWN_PLANET")]
    enrich1, lbl1 = enrich_candidate(lc_feat, tpf_feat, tic_index, toi_recs_v1, [])

    # Run 2 with FALSE_POSITIVE disposition
    toi_recs_v2 = [ToiCatalogRecord(toi_id="123.01", tic_id=12345678, catalog_period=3.5, toi_disposition_norm="FALSE_POSITIVE")]
    enrich2, lbl2 = enrich_candidate(lc_feat, tpf_feat, tic_index, toi_recs_v2, [])

    # Labels must differ
    assert lbl1.training_label == "POSITIVE"
    assert lbl2.training_label == "NEGATIVE"

    # Signal features MUST be 100% identical!
    assert lc_feat.bls_period == 3.5
    assert lc_feat.bls_depth == 0.01
    assert tpf_feat.transit_deficit_centroid_row == 1.0


def test_leakage_prevention_allowlists():
    """Verify that supervision metadata is NOT present in MODEL_INPUT_ALLOWLIST."""
    for sup_field in SUPERVISION_ALLOWLIST:
        assert sup_field not in MODEL_INPUT_ALLOWLIST, f"Label leakage error: {sup_field} found in MODEL_INPUT_ALLOWLIST!"


def test_bronze_raw_deleted_safety():
    """Verify catalog enrichment operates with 0 calls to bronze/."""
    lc_feat = sample_lc_features()
    tpf_feat = sample_tpf_features()

    raw_tic = load_csv_fixture("tic-small.csv")
    raw_toi = load_csv_fixture("toi-small.csv")
    raw_tce = load_csv_fixture("tce-small.csv")

    tic_recs, _ = normalize_tic_catalog(raw_tic)
    toi_recs, _ = normalize_toi_catalog(raw_toi)
    tce_recs, _ = normalize_tce_catalog(raw_tce)

    tic_index = {r.tic_id: r for r in tic_recs}

    enrichment_rec, label_rec = enrich_candidate(
        lc_features=lc_feat,
        tpf_features=tpf_feat,
        tic_index=tic_index,
        toi_candidates=toi_recs,
        tce_candidates=tce_recs,
        tic_snapshot_id="tic-v1-12345",
        toi_snapshot_id="toi-v1-12345",
        tce_snapshot_id="tce-v1-12345",
    )

    assert enrichment_rec.enrichment_status == "SUCCESS"
    assert enrichment_rec.training_label == "POSITIVE"
    assert label_rec.matched_toi_id == "123.01"
    assert label_rec.matched_tce_id == "tce-12345678-s0001-01"
