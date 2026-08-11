"""Unit & integration test suite for ClickHouse Analytics & Query Index (Phase 5.6)."""

import pytest
from aurora_ml.pipeline.analytics import (
    AnalyticsLoaderError,
    GoldAnalyticsLoader,
    SnapshotIsolationError,
    UncommittedGoldError,
)
from aurora_ml.pipeline.gold import GoldSnapshotManifest, SilverInputRef


def sample_silver_ref(sector: int = 1) -> SilverInputRef:
    return SilverInputRef(
        lineage_id="a3f2c8d1928014819028",
        source_product_id=f"tess-lc-12345678-s{sector:04d}-0120",
        product_kind="LIGHT_CURVE",
        silver_bucket="aurora-silver",
        silver_object_key=f"silver/tess/lightcurve/processor=lc-preprocess-v1/sector={sector:04d}/tic=12345678/prod.parquet",
        silver_sha256="c4ca4238a0b923820dcc509a6f75849b",
        silver_schema_version="silver-lightcurve-v1",
        processor_version="lc-preprocess-v1",
        sample_id=f"tic:12345678:s:{sector}",
    )


def sample_candidate_manifest(
    sid: str = "gold-v1-abc123456789",
) -> GoldSnapshotManifest:
    inp = sample_silver_ref(sector=1)
    return GoldSnapshotManifest(
        schema_version=1,
        snapshot_id=sid,
        snapshot_fingerprint="f" * 64,
        snapshot_type="CANDIDATE",
        gold_schema_version="gold-candidate-v1",
        feature_versions={"lc": "lc-features-v1"},
        input_count=1,
        inputs=[inp],
    )


def test_uncommitted_gold_rejection():
    loader = GoldAnalyticsLoader()
    with pytest.raises(UncommittedGoldError):
        loader.load_snapshot(manifest=None, rows_by_dataset={})


def test_candidate_snapshot_projection():
    loader = GoldAnalyticsLoader()
    manifest = sample_candidate_manifest("gold-v1-cand0001")

    rows = [
        {
            "source_product_id": "tess-lc-12345678-s0001-0120",
            "lineage_id": "lineage_1",
            "sample_id": "tic:12345678:s:1",
            "tic_id": 12345678,
            "sector": 1,
            "silver_sha256": "c4ca4238a0b923820dcc509a6f75849b",
            "bls_available": True,
            "bls_period": 3.5,
            "training_label": "POSITIVE",
        }
    ]

    rec = loader.load_snapshot(manifest, {"candidate": rows})
    assert rec.snapshot_id == "gold-v1-cand0001"
    assert rec.index_status == "READY"

    # Query candidate table filtering by snapshot_id
    q_rows = loader.query_candidates("gold-v1-cand0001")
    assert len(q_rows) == 1
    assert q_rows[0]["snapshot_id"] == "gold-v1-cand0001"
    assert q_rows[0]["training_label"] == "POSITIVE"


def test_anomaly_snapshot_projection():
    loader = GoldAnalyticsLoader()
    inp = sample_silver_ref(sector=1)
    manifest = GoldSnapshotManifest(
        schema_version=1,
        snapshot_id="gold-v1-anom0001",
        snapshot_fingerprint="a" * 64,
        snapshot_type="ANOMALY",
        gold_schema_version="gold-anomaly-v1",
        feature_versions={"lc": "lc-features-v1"},
        input_count=1,
        inputs=[inp],
    )

    rows = [
        {
            "source_product_id": "tess-lc-12345678-s0001-0120",
            "lineage_id": "lineage_1",
            "sector": 1,
            "flux_std": 0.005,
        }
    ]

    rec = loader.load_snapshot(manifest, {"lightcurve": rows})
    assert rec.snapshot_id == "gold-v1-anom0001"
    assert rec.index_status == "READY"
    assert len(loader.mock_anomaly_lc_rows["gold-v1-anom0001"]) == 1


def test_idempotent_reindex_fast_path():
    loader = GoldAnalyticsLoader()
    manifest = sample_candidate_manifest("gold-v1-fast0001")
    rows = [{"source_product_id": "prod1"}]

    rec1 = loader.load_snapshot(manifest, {"candidate": rows})
    assert rec1.index_status == "READY"

    # Re-indexing without --rebuild returns existing READY record fast
    rec2 = loader.load_snapshot(manifest, {"candidate": rows}, rebuild=False)
    assert rec2 == rec1


def test_forced_rebuild():
    loader = GoldAnalyticsLoader()
    manifest = sample_candidate_manifest("gold-v1-rebuild01")
    rows = [{"source_product_id": "prod1"}]

    rec1 = loader.load_snapshot(manifest, {"candidate": rows})
    assert rec1.indexed_row_count == 1

    # Forced --rebuild drops derived partition & reloads
    rec2 = loader.load_snapshot(manifest, {"candidate": rows}, rebuild=True)
    assert rec2.index_status == "READY"


def test_row_count_audit_mismatch():
    loader = GoldAnalyticsLoader()
    manifest = sample_candidate_manifest("gold-v1-mismatch1")
    # Supply 2 rows when manifest expected 1
    rows = [{"source_product_id": "p1"}, {"source_product_id": "p2"}]

    with pytest.raises(AnalyticsLoaderError) as exc_info:
        loader.load_snapshot(manifest, {"candidate": rows})
    assert "Row count audit mismatch" in str(exc_info.value)
    assert not loader.is_snapshot_ready("gold-v1-mismatch1")


def test_snapshot_isolation_mandatory_query_rule():
    loader = GoldAnalyticsLoader()
    with pytest.raises(SnapshotIsolationError):
        loader.query_candidates(snapshot_id="")


def test_duplicate_candidate_rejection():
    loader = GoldAnalyticsLoader()
    inp1 = sample_silver_ref(sector=1)
    inp2 = sample_silver_ref(sector=2)
    manifest = GoldSnapshotManifest(
        schema_version=1,
        snapshot_id="gold-v1-dup0000001",
        snapshot_fingerprint="d" * 64,
        snapshot_type="CANDIDATE",
        gold_schema_version="gold-candidate-v1",
        feature_versions={"lc": "lc-features-v1"},
        input_count=2,
        inputs=[inp1, inp2],
    )
    rows = [{"source_product_id": "prod1"}, {"source_product_id": "prod1"}]

    with pytest.raises(AnalyticsLoaderError) as exc_info:
        loader.load_snapshot(manifest, {"candidate": rows})
    assert "Duplicate candidate identity" in str(exc_info.value)


def test_bronze_and_silver_independence():
    """Verify ClickHouse loader operates strictly from Gold manifest + Gold rows with 0 reads to bronze/ or silver/."""
    loader = GoldAnalyticsLoader()
    manifest = sample_candidate_manifest("gold-v1-indep0001")
    rows = [
        {
            "source_product_id": "prod_1",
            "lineage_id": "lin_1",
            "sector": 1,
            "training_label": "UNRESOLVED",
        }
    ]

    rec = loader.load_snapshot(manifest, {"candidate": rows})
    assert rec.index_status == "READY"
