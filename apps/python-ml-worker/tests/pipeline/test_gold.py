"""Unit & integration tests for Gold Snapshot Contract, Identity, and Planning."""

import json
import pytest

from aurora_ml.data import parse_lineage_to_silver_ref
from aurora_ml.pipeline.gold import (
    GoldSnapshotManifest,
    GoldSnapshotPlanner,
    SilverInputRef,
    derive_snapshot_identity,
    sort_silver_inputs,
)


def sample_silver_ref_1() -> SilverInputRef:
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


def sample_silver_ref_2() -> SilverInputRef:
    return SilverInputRef(
        lineage_id="b4e3d9e2039125920139",
        source_product_id="tess-lc-87654321-s0001-0120",
        product_kind="LIGHT_CURVE",
        silver_bucket="aurora-silver",
        silver_object_key="silver/tess/lightcurve/processor=lc-preprocess-v1/sector=0001/tic=87654321/lc2.parquet",
        silver_sha256="c81e728d9d4c2f636f067f89cc14862c",
        silver_schema_version="silver-lightcurve-v1",
        processor_version="lc-preprocess-v1",
        sample_id="tic:87654321:s:1",
    )


def test_derive_snapshot_identity_determinism():
    ref1 = sample_silver_ref_1()
    ref2 = sample_silver_ref_2()

    id1, fp1 = derive_snapshot_identity(
        snapshot_type="CANDIDATE",
        gold_schema_version="gold-candidate-v1",
        feature_versions={"LIGHT_CURVE": "lc-features-v1"},
        inputs=[ref1, ref2],
    )

    id2, fp2 = derive_snapshot_identity(
        snapshot_type="CANDIDATE",
        gold_schema_version="gold-candidate-v1",
        feature_versions={"LIGHT_CURVE": "lc-features-v1"},
        inputs=[ref1, ref2],
    )

    assert id1 == id2
    assert fp1 == fp2
    assert id1.startswith("gold-v1-")
    assert len(fp1) == 64


def test_derive_snapshot_identity_input_order_independence():
    ref1 = sample_silver_ref_1()
    ref2 = sample_silver_ref_2()

    id1, fp1 = derive_snapshot_identity(
        snapshot_type="CANDIDATE",
        gold_schema_version="gold-candidate-v1",
        feature_versions={"LIGHT_CURVE": "lc-features-v1"},
        inputs=[ref1, ref2],
    )

    id2, fp2 = derive_snapshot_identity(
        snapshot_type="CANDIDATE",
        gold_schema_version="gold-candidate-v1",
        feature_versions={"LIGHT_CURVE": "lc-features-v1"},
        inputs=[ref2, ref1],  # Reverse order
    )

    assert id1 == id2
    assert fp1 == fp2


def test_derive_snapshot_identity_created_at_independence():
    ref1 = sample_silver_ref_1()
    planner = GoldSnapshotPlanner()

    plan1 = planner.plan_snapshot(
        snapshot_type="CANDIDATE",
        gold_schema_version="gold-candidate-v1",
        feature_versions={"LIGHT_CURVE": "lc-features-v1"},
        inputs=[ref1],
    )

    plan2 = planner.plan_snapshot(
        snapshot_type="CANDIDATE",
        gold_schema_version="gold-candidate-v1",
        feature_versions={"LIGHT_CURVE": "lc-features-v1"},
        inputs=[ref1],
    )

    # Different created_at timestamps must NOT alter snapshot identity
    plan1.manifest.created_at = "2026-01-01T00:00:00Z"
    plan2.manifest.created_at = "2026-08-08T12:00:00Z"

    assert plan1.snapshot_id == plan2.snapshot_id
    assert plan1.snapshot_fingerprint == plan2.snapshot_fingerprint


def test_derive_snapshot_identity_input_addition():
    ref1 = sample_silver_ref_1()
    ref2 = sample_silver_ref_2()

    id1, _ = derive_snapshot_identity(
        snapshot_type="CANDIDATE",
        gold_schema_version="gold-candidate-v1",
        feature_versions={"LIGHT_CURVE": "lc-features-v1"},
        inputs=[ref1],
    )

    id2, _ = derive_snapshot_identity(
        snapshot_type="CANDIDATE",
        gold_schema_version="gold-candidate-v1",
        feature_versions={"LIGHT_CURVE": "lc-features-v1"},
        inputs=[ref1, ref2],
    )

    assert id1 != id2


def test_derive_snapshot_identity_silver_sha_change():
    ref1 = sample_silver_ref_1()
    ref1_mod = SilverInputRef(
        lineage_id=ref1.lineage_id,
        source_product_id=ref1.source_product_id,
        product_kind=ref1.product_kind,
        silver_bucket=ref1.silver_bucket,
        silver_object_key=ref1.silver_object_key,
        silver_sha256="modified_sha256_hash_value_12345",
        silver_schema_version=ref1.silver_schema_version,
        processor_version=ref1.processor_version,
        sample_id=ref1.sample_id,
    )

    id1, _ = derive_snapshot_identity(
        snapshot_type="CANDIDATE",
        gold_schema_version="gold-candidate-v1",
        feature_versions={"LIGHT_CURVE": "lc-features-v1"},
        inputs=[ref1],
    )

    id2, _ = derive_snapshot_identity(
        snapshot_type="CANDIDATE",
        gold_schema_version="gold-candidate-v1",
        feature_versions={"LIGHT_CURVE": "lc-features-v1"},
        inputs=[ref1_mod],
    )

    assert id1 != id2


def test_derive_snapshot_identity_processor_version_change():
    ref1 = sample_silver_ref_1()
    ref1_v2 = SilverInputRef(
        lineage_id=ref1.lineage_id,
        source_product_id=ref1.source_product_id,
        product_kind=ref1.product_kind,
        silver_bucket=ref1.silver_bucket,
        silver_object_key=ref1.silver_object_key,
        silver_sha256=ref1.silver_sha256,
        silver_schema_version=ref1.silver_schema_version,
        processor_version="lc-preprocess-v2",
        sample_id=ref1.sample_id,
    )

    id1, _ = derive_snapshot_identity(
        snapshot_type="CANDIDATE",
        gold_schema_version="gold-candidate-v1",
        feature_versions={"LIGHT_CURVE": "lc-features-v1"},
        inputs=[ref1],
    )

    id2, _ = derive_snapshot_identity(
        snapshot_type="CANDIDATE",
        gold_schema_version="gold-candidate-v1",
        feature_versions={"LIGHT_CURVE": "lc-features-v1"},
        inputs=[ref1_v2],
    )

    assert id1 != id2


def test_derive_snapshot_identity_feature_version_change():
    ref1 = sample_silver_ref_1()

    id1, _ = derive_snapshot_identity(
        snapshot_type="CANDIDATE",
        gold_schema_version="gold-candidate-v1",
        feature_versions={"LIGHT_CURVE": "lc-features-v1"},
        inputs=[ref1],
    )

    id2, _ = derive_snapshot_identity(
        snapshot_type="CANDIDATE",
        gold_schema_version="gold-candidate-v1",
        feature_versions={"LIGHT_CURVE": "lc-features-v2"},
        inputs=[ref1],
    )

    assert id1 != id2


def test_derive_snapshot_identity_schema_change():
    ref1 = sample_silver_ref_1()

    id1, _ = derive_snapshot_identity(
        snapshot_type="CANDIDATE",
        gold_schema_version="gold-candidate-v1",
        feature_versions={"LIGHT_CURVE": "lc-features-v1"},
        inputs=[ref1],
    )

    id2, _ = derive_snapshot_identity(
        snapshot_type="CANDIDATE",
        gold_schema_version="gold-candidate-v2",
        feature_versions={"LIGHT_CURVE": "lc-features-v1"},
        inputs=[ref1],
    )

    assert id1 != id2


def test_derive_snapshot_identity_label_snapshot_change():
    ref1 = sample_silver_ref_1()

    id1, _ = derive_snapshot_identity(
        snapshot_type="CANDIDATE",
        gold_schema_version="gold-candidate-v1",
        feature_versions={"LIGHT_CURVE": "lc-features-v1"},
        inputs=[ref1],
        label_snapshots={"TOI": "2026-08-01"},
    )

    id2, _ = derive_snapshot_identity(
        snapshot_type="CANDIDATE",
        gold_schema_version="gold-candidate-v1",
        feature_versions={"LIGHT_CURVE": "lc-features-v1"},
        inputs=[ref1],
        label_snapshots={"TOI": "2026-08-08"},
    )

    assert id1 != id2


def test_bronze_raw_deleted_equivalence():
    """Verify that a Lineage record with Bronze RAW_DELETED status parses to a valid SilverInputRef

    and produces the EXACT SAME snapshot_id as when Bronze was retained.
    """
    lineage_retained = {
        "schema_version": 1,
        "lineage_id": "a3f2c8d1928014819028",
        "status": "LINEAGE_COMMITTED",
        "source": {
            "provider": "MAST",
            "mission": "TESS",
            "source_product_id": "tess-lc-12345678-s0001-0120",
        },
        "bronze": {
            "bucket": "aurora-bronze",
            "object_key": "tess/lightcurve/sector=0001/lc.fits",
            "size_bytes": 2097152,
            "sha256": "d41d8cd98f00b204e9800998ecf8427e",
            "product_kind": "LIGHT_CURVE",
            "sector": 1,
            "tic_id": 12345678,
        },
        "processing": {
            "service": "rust-preprocessor",
            "processor_version": "lc-preprocess-v1",
        },
        "silver": {
            "bucket": "aurora-silver",
            "object_key": "silver/tess/lightcurve/processor=lc-preprocess-v1/sector=0001/tic=12345678/lc1.parquet",
            "size_bytes": 131072,
            "sha256": "c4ca4238a0b923820dcc509a6f75849b",
            "schema_version": "silver-lightcurve-v1",
            "processor_version": "lc-preprocess-v1",
        },
        "lifecycle": {
            "status": "RETAINED",
        },
    }

    lineage_raw_deleted = dict(lineage_retained)
    lineage_raw_deleted["lifecycle"] = {"status": "RAW_DELETED"}

    ref_retained = parse_lineage_to_silver_ref(lineage_retained)
    ref_raw_deleted = parse_lineage_to_silver_ref(lineage_raw_deleted)

    assert ref_retained is not None
    assert ref_raw_deleted is not None
    assert ref_retained == ref_raw_deleted

    id_retained, fp_retained = derive_snapshot_identity(
        snapshot_type="CANDIDATE",
        gold_schema_version="gold-candidate-v1",
        feature_versions={"LIGHT_CURVE": "lc-features-v1"},
        inputs=[ref_retained],
    )

    id_raw_deleted, fp_raw_deleted = derive_snapshot_identity(
        snapshot_type="CANDIDATE",
        gold_schema_version="gold-candidate-v1",
        feature_versions={"LIGHT_CURVE": "lc-features-v1"},
        inputs=[ref_raw_deleted],
    )

    assert id_retained == id_raw_deleted
    assert fp_retained == fp_raw_deleted


def test_planner_validation_duplicate_input():
    ref1 = sample_silver_ref_1()
    planner = GoldSnapshotPlanner()

    with pytest.raises(ValueError, match="Duplicate Silver input reference"):
        planner.plan_snapshot(
            snapshot_type="CANDIDATE",
            gold_schema_version="gold-candidate-v1",
            feature_versions={"LIGHT_CURVE": "lc-features-v1"},
            inputs=[ref1, ref1],
        )


def test_planner_validation_unsupported_silver_schema():
    ref_invalid = SilverInputRef(
        lineage_id="a3f2c8d1928014819028",
        source_product_id="tess-lc-12345678-s0001-0120",
        product_kind="LIGHT_CURVE",
        silver_bucket="aurora-silver",
        silver_object_key="silver/lc1.parquet",
        silver_sha256="c4ca4238a0b923820dcc509a6f75849b",
        silver_schema_version="silver-lightcurve-v999",  # Unsupported
        processor_version="lc-preprocess-v1",
    )
    planner = GoldSnapshotPlanner()

    with pytest.raises(ValueError, match="Unsupported Silver schema version"):
        planner.plan_snapshot(
            snapshot_type="CANDIDATE",
            gold_schema_version="gold-candidate-v1",
            feature_versions={"LIGHT_CURVE": "lc-features-v1"},
            inputs=[ref_invalid],
        )


def test_planner_validation_mixed_processor_versions():
    ref1 = sample_silver_ref_1()
    ref2_v2 = SilverInputRef(
        lineage_id="b4e3d9e2039125920139",
        source_product_id="tess-lc-87654321-s0001-0120",
        product_kind="LIGHT_CURVE",
        silver_bucket="aurora-silver",
        silver_object_key="silver/lc2.parquet",
        silver_sha256="c81e728d9d4c2f636f067f89cc14862c",
        silver_schema_version="silver-lightcurve-v1",
        processor_version="lc-preprocess-v2",  # Mixed v1 vs v2
        sample_id="tic:87654321:s:1",
    )
    planner = GoldSnapshotPlanner()

    with pytest.raises(ValueError, match="Mixed processor versions"):
        planner.plan_snapshot(
            snapshot_type="CANDIDATE",
            gold_schema_version="gold-candidate-v1",
            feature_versions={"LIGHT_CURVE": "lc-features-v1"},
            inputs=[ref1, ref2_v2],
        )


def test_manifest_json_roundtrip():
    ref1 = sample_silver_ref_1()
    ref2 = sample_silver_ref_2()
    planner = GoldSnapshotPlanner()

    plan = planner.plan_snapshot(
        snapshot_type="CANDIDATE",
        gold_schema_version="gold-candidate-v1",
        feature_versions={"LIGHT_CURVE": "lc-features-v1"},
        inputs=[ref1, ref2],
    )

    json_str = plan.manifest.to_json()
    manifest_deserialized = GoldSnapshotManifest.from_json(json_str)

    assert manifest_deserialized.snapshot_id == plan.manifest.snapshot_id
    assert manifest_deserialized.snapshot_fingerprint == plan.manifest.snapshot_fingerprint
    assert manifest_deserialized.input_count == 2
    assert len(manifest_deserialized.inputs) == 2
    assert manifest_deserialized.inputs[0].lineage_id == plan.manifest.inputs[0].lineage_id
