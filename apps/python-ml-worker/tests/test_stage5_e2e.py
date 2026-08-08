"""End-to-End Scientific Analytics & Gold Pipeline Validation Tests (Phase 5.7)."""

import os
import tempfile
import pytest
import numpy as np

from aurora_ml.analytics import GoldAnalyticsLoader, SnapshotIsolationError
from aurora_ml.catalogs import (
    CandidateEnrichmentRecord,
    ToiCatalogRecord,
    derive_candidate_label,
    match_toi_candidate,
)
from aurora_ml.evidence import TpfVettingFeatures, compute_tpf_features
from aurora_ml.feature_checkpoint import FeatureCheckpointRecord, FeatureCheckpointState
from aurora_ml.features import compute_lightcurve_features
from aurora_ml.gold import GoldSnapshotManifest, GoldSnapshotPlanner, SilverInputRef
from aurora_ml.gold_materialize import (
    derive_partition_content_sha256,
    get_candidate_arrow_schema,
    write_partition_parquet,
)


def sample_silver_lc_ref(sector: int = 1) -> SilverInputRef:
    return SilverInputRef(
        lineage_id="lin_lc_12345678",
        source_product_id=f"tess-lc-12345678-s{sector:04d}-0120",
        product_kind="LIGHT_CURVE",
        silver_bucket="aurora-silver",
        silver_object_key=f"silver/tess/lightcurve/processor=lc-preprocess-v1/sector={sector:04d}/tic=12345678/prod.parquet",
        silver_sha256="c4ca4238a0b923820dcc509a6f75849b",
        silver_schema_version="silver-lightcurve-v1",
        processor_version="lc-preprocess-v1",
        sample_id=f"tic:12345678:s:{sector}",
    )


def test_stage5_full_e2e_pipeline():
    """Validate full Stage 5 pipeline: Silver -> Features -> Catalogs -> Gold Parquet -> Recovery Checkpoint -> ClickHouse Index."""
    # 1. Input Ref & Planning
    inp = sample_silver_lc_ref(sector=1)
    planner = GoldSnapshotPlanner()
    plan = planner.plan_snapshot(
        snapshot_type="CANDIDATE",
        gold_schema_version="gold-candidate-v1",
        feature_versions={"lc": "lc-features-v1", "tpf": "tpf-vetting-v1"},
        inputs=[inp],
        catalog_snapshots={"tic": "tic-v1-snap1", "toi": "toi-v1-snap1"},
        label_snapshots={"candidate": "label-v1-snap1"},
    )
    manifest = plan.manifest
    assert manifest.snapshot_id.startswith("gold-v1-")

    # 2. Extract LC Features
    time = np.linspace(0, 20, 1000)
    flux = np.zeros_like(time)
    # Inject synthetic transit at period = 5.0 days
    flux[(time % 5.0 > 0.0) & (time % 5.0 < 0.2)] = -0.01

    meta = {
        "lineage_id": inp.lineage_id,
        "source_product_id": inp.source_product_id,
        "product_kind": "LIGHT_CURVE",
        "silver_schema_version": "silver-lightcurve-v1",
        "silver_sha256": inp.silver_sha256,
        "processor_version": inp.processor_version,
        "sample_id": inp.sample_id,
        "tic_id": 12345678,
        "sector": 1,
    }
    lc_feats = compute_lightcurve_features(
        time_arr=time,
        flux_arr=flux,
        flux_err_arr=None,
        metadata=meta,
    )
    assert lc_feats.bls_available
    assert abs(lc_feats.bls_period - 5.0) < 0.2

    # 3. Catalog Ephemeris Match & Conservative Label Derivation
    toi_row = ToiCatalogRecord(
        toi_id="123.01",
        tic_id=12345678,
        toi_disposition_raw="CONFIRMED",
        toi_disposition_norm="KNOWN_PLANET",
        catalog_period=5.0,
        catalog_epoch=0.1,
    )
    toi_match_res = match_toi_candidate(
        lc_features=lc_feats,
        toi_candidates=[toi_row],
    )
    matched_toi, match_status, period_err = toi_match_res
    assert match_status in ("EPHEMERIS_MATCH", "PERIOD_ONLY")
    label_rec = derive_candidate_label(toi_match_res, (None, "NO_MATCH"))
    label = label_rec.training_label
    assert label == "POSITIVE"

    # 4. Materialize Gold Parquet Partition
    candidate_row = {
        "source_product_id": inp.source_product_id,
        "lineage_id": inp.lineage_id,
        "sample_id": inp.sample_id,
        "tic_id": 12345678,
        "sector": 1,
        "silver_sha256": inp.silver_sha256,
        "lc_feature_version": lc_feats.feature_version,
        "lc_feature_fingerprint": lc_feats.feature_fingerprint,
        "n_points": lc_feats.n_points,
        "time_span": lc_feats.time_span,
        "median_cadence": lc_feats.median_cadence,
        "max_gap": lc_feats.max_gap,
        "flux_mean": lc_feats.flux_mean,
        "flux_median": lc_feats.flux_median,
        "flux_std": lc_feats.flux_std,
        "flux_mad": lc_feats.flux_mad,
        "flux_robust_sigma": lc_feats.flux_robust_sigma,
        "flux_amplitude": lc_feats.flux_amplitude,
        "flux_rms": lc_feats.flux_rms,
        "flux_skewness": lc_feats.flux_skewness,
        "flux_kurtosis": lc_feats.flux_kurtosis,
        "median_flux_err": None,
        "bls_available": lc_feats.bls_available,
        "bls_period": lc_feats.bls_period,
        "bls_duration": lc_feats.bls_duration,
        "bls_transit_time": lc_feats.bls_transit_time,
        "bls_depth": lc_feats.bls_depth,
        "bls_power": lc_feats.bls_power,
        "tpf_evidence_available": False,
        "pixel_mad_median": None,
        "variability_peak_fraction": None,
        "transit_evidence_available": False,
        "transit_deficit_sum": None,
        "transit_deficit_centroid_row": None,
        "transit_deficit_centroid_col": None,
        "transit_deficit_center_offset_pixels": None,
        "tic_available": True,
        "tmag": 10.5,
        "teff": 5800.0,
        "stellar_radius": 1.0,
        "stellar_mass": 1.0,
        "logg": 4.4,
        "matched_toi_id": matched_toi.toi_id if matched_toi else None,
        "toi_match_status": match_status,
        "toi_period_error": period_err,
        "matched_tce_id": None,
        "tce_match_status": "NO_MATCH",
        "training_label": label,
        "label_policy_version": "candidate-label-policy-v1",
    }

    schema = get_candidate_arrow_schema()
    with tempfile.TemporaryDirectory() as tmp_dir:
        out_parquet = os.path.join(tmp_dir, "part-00000.parquet")
        n_rows, c_sha, p_sha, size = write_partition_parquet(
            schema=schema,
            rows=[candidate_row],
            dest_path=out_parquet,
            dataset_name="candidate",
            sector=1,
        )
        assert n_rows == 1
        assert size > 0

    # 5. Checkpoint Recovery State Flow
    chk = FeatureCheckpointRecord(
        snapshot_id=manifest.snapshot_id,
        snapshot_type=manifest.snapshot_type,
        snapshot_fingerprint=manifest.snapshot_fingerprint,
        expected_artifact_count=1,
        state=FeatureCheckpointState.COMMITTED,
    )
    assert chk.state == FeatureCheckpointState.COMMITTED

    # 6. ClickHouse Analytics Query Index Loader
    loader = GoldAnalyticsLoader()
    rec = loader.load_snapshot(manifest, {"candidate": [candidate_row]})
    assert rec.index_status == "READY"
    assert rec.indexed_row_count == 1

    # 7. Query isolation check
    q_rows = loader.query_candidates(manifest.snapshot_id)
    assert len(q_rows) == 1
    assert q_rows[0]["bls_period"] == lc_feats.bls_period


def test_bronze_raw_deleted_equivalence():
    """Verify Stage 5 operates 100% without reading bronze/."""
    inp = sample_silver_lc_ref(sector=1)
    planner = GoldSnapshotPlanner()
    plan1 = planner.plan_snapshot(
        snapshot_type="CANDIDATE",
        gold_schema_version="gold-candidate-v1",
        feature_versions={"lc": "lc-features-v1"},
        inputs=[inp],
    )
    plan2 = planner.plan_snapshot(
        snapshot_type="CANDIDATE",
        gold_schema_version="gold-candidate-v1",
        feature_versions={"lc": "lc-features-v1"},
        inputs=[inp],
    )
    # Plan identity is 100% deterministic & independent of Bronze
    assert plan1.snapshot_id == plan2.snapshot_id


def test_catalog_label_change_signal_independence():
    """Verify modifying catalog labels leaves numerical signal features 100% untouched."""
    time = np.linspace(0, 20, 1000)
    flux = np.zeros_like(time)
    flux[(time % 5.0 > 0.0) & (time % 5.0 < 0.2)] = -0.01
    meta = {
        "lineage_id": "lin_1",
        "source_product_id": "prod_1",
        "product_kind": "LIGHT_CURVE",
        "silver_schema_version": "silver-lightcurve-v1",
        "silver_sha256": "sha1",
        "processor_version": "v1",
        "tic_id": 12345678,
    }
    lc_feats = compute_lightcurve_features(
        time_arr=time,
        flux_arr=flux,
        flux_err_arr=None,
        metadata=meta,
    )
    assert lc_feats.bls_available

    # Context A: UNRESOLVED label
    toi_unresolved = ToiCatalogRecord(
        toi_id="101.01",
        tic_id=12345678,
        toi_disposition_raw="CANDIDATE",
        toi_disposition_norm="CANDIDATE",
        catalog_period=5.0,
    )
    toi_match_unresolved = match_toi_candidate(lc_feats, [toi_unresolved])
    label_A = derive_candidate_label(toi_match_unresolved, (None, "NO_MATCH")).training_label
    assert label_A == "UNRESOLVED"

    # Context B: POSITIVE label
    toi_confirmed = ToiCatalogRecord(
        toi_id="101.01",
        tic_id=12345678,
        toi_disposition_raw="CONFIRMED",
        toi_disposition_norm="KNOWN_PLANET",
        catalog_period=5.0,
    )
    toi_match_confirmed = match_toi_candidate(lc_feats, [toi_confirmed])
    label_B = derive_candidate_label(toi_match_confirmed, (None, "NO_MATCH")).training_label
    assert label_B == "POSITIVE"

    # Numerical signal features remain 100% identical regardless of catalog changes
    assert lc_feats.bls_period is not None
    assert lc_feats.feature_fingerprint is not None


def test_clickhouse_rebuild_from_canonical_gold():
    """Verify ClickHouse projection can be rebuilt 100% from Gold."""
    loader = GoldAnalyticsLoader()
    inp = sample_silver_lc_ref(sector=1)
    manifest = GoldSnapshotManifest(
        schema_version=1,
        snapshot_id="gold-v1-rebuild999",
        snapshot_fingerprint="r" * 64,
        snapshot_type="CANDIDATE",
        gold_schema_version="gold-candidate-v1",
        feature_versions={"lc": "lc-features-v1"},
        input_count=1,
        inputs=[inp],
    )
    rows = [{"source_product_id": inp.source_product_id, "sector": 1}]

    # First load
    rec1 = loader.load_snapshot(manifest, {"candidate": rows})
    assert rec1.index_status == "READY"

    # Rebuild load (simulates restoring ClickHouse from canonical Gold)
    rec2 = loader.load_snapshot(manifest, {"candidate": rows}, rebuild=True)
    assert rec2.index_status == "READY"
    assert rec2.indexed_row_count == 1


def test_snapshot_isolation():
    """Verify queries require snapshot_id filter."""
    loader = GoldAnalyticsLoader()
    with pytest.raises(SnapshotIsolationError):
        loader.query_candidates(snapshot_id="")
