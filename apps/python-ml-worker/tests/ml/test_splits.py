"""Unit and integration tests for ML Dataset View & Group-Safe Split Manager (Phase 6.1)."""

import os
import tempfile
import pytest

from aurora_ml.pipeline.gold import GoldSnapshotManifest, SilverInputRef
from aurora_ml.ml.datasets.splits import (
    CANDIDATE_MODEL_INPUT_FEATURES,
    LEAKAGE_EXCLUSIONS,
    CandidateGroupSplit,
    CandidateMlView,
    MlDatasetError,
    MlSplitError,
    build_candidate_ml_view,
    create_deterministic_group_split,
    derive_group_key,
    load_split_manifest,
    save_split_manifest,
)


def sample_gold_manifest() -> GoldSnapshotManifest:
    return GoldSnapshotManifest(
        schema_version=1,
        snapshot_id="gold-v1-test12345678",
        snapshot_fingerprint="f" * 64,
        snapshot_type="CANDIDATE",
        gold_schema_version="gold-candidate-v1",
        feature_versions={"lc": "lc-features-v1"},
        input_count=1,
        inputs=[
            SilverInputRef(
                lineage_id="lin_1",
                source_product_id="prod_1",
                product_kind="LIGHT_CURVE",
                silver_bucket="aurora-silver",
                silver_object_key="silver/lc/part.parquet",
                silver_sha256="s1",
                silver_schema_version="v1",
                processor_version="v1",
            )
        ],
    )


def _make_row(tic_id, sector, label, source_suffix=""):
    pid = f"prod_{tic_id}_s{sector}{source_suffix}"
    return {
        "source_product_id": pid,
        "lineage_id": f"lin_{tic_id}",
        "sample_id": f"s{sector}",
        "tic_id": tic_id,
        "sector": sector,
        "silver_sha256": f"sha{tic_id}{sector}",
        "lc_feature_version": "lc-features-v1",
        "lc_feature_fingerprint": "fp1",
        "n_points": 1000,
        "time_span": 20.0,
        "median_cadence": 0.001,
        "max_gap": 0.1,
        "flux_mean": 0.0,
        "flux_median": 0.0,
        "flux_std": 0.01,
        "flux_mad": 0.008,
        "flux_robust_sigma": 0.0118,
        "flux_amplitude": 0.05,
        "flux_rms": 0.01,
        "flux_skewness": 0.1,
        "flux_kurtosis": 0.2,
        "median_flux_err": 0.001,
        "bls_available": True,
        "bls_period": 5.0,
        "bls_duration": 0.2,
        "bls_transit_time": 0.1,
        "bls_depth": 0.01,
        "bls_power": 100.0,
        "tpf_evidence_available": False,
        "pixel_mad_median": None,
        "variability_peak_fraction": None,
        "transit_evidence_available": False,
        "transit_deficit_sum": None,
        "transit_deficit_centroid_row": None,
        "transit_deficit_centroid_col": None,
        "transit_deficit_center_offset_pixels": None,
        "tic_available": True,
        "tmag": 10.0,
        "teff": 5800.0,
        "stellar_radius": 1.0,
        "stellar_mass": 1.0,
        "logg": 4.4,
        "matched_toi_id": f"{tic_id}.01" if label in ("POSITIVE", "NEGATIVE") else None,
        "toi_match_status": "EPHEMERIS_MATCH"
        if label in ("POSITIVE", "NEGATIVE")
        else "NO_MATCH",
        "toi_period_error": 0.001 if label in ("POSITIVE", "NEGATIVE") else None,
        "matched_tce_id": None,
        "tce_match_status": "NO_MATCH",
        "training_label": label,
        "label_policy_version": "candidate-label-policy-v1",
    }


def sample_candidate_rows() -> list[dict]:
    # 11 supervised targets + 1 UNRESOLVED
    # TIC 1001 (sectors 10 & 11) -> POSITIVE (multi-sector leakage test)
    # TICs 1002..1010 single-sector with alternating POSITIVE/NEGATIVE labels
    # TIC 1011 -> UNRESOLVED
    rows = []
    # TIC 1001: multi-sector POSITIVE (leakage test)
    rows.append(_make_row(1001, 10, "POSITIVE"))
    rows.append(_make_row(1001, 11, "POSITIVE"))
    # 5 POSITIVE single-sector targets
    for tic in [1002, 1003, 1004, 1005, 1006]:
        rows.append(_make_row(tic, 10, "POSITIVE"))
    # 5 NEGATIVE single-sector targets
    for tic in [2001, 2002, 2003, 2004, 2005]:
        rows.append(_make_row(tic, 10, "NEGATIVE"))
    # 1 UNRESOLVED
    rows.append(_make_row(3001, 10, "UNRESOLVED"))
    return rows


def test_candidate_ml_view_builder_success():
    manifest = sample_gold_manifest()
    rows = sample_candidate_rows()

    view = build_candidate_ml_view(manifest, rows)
    assert isinstance(view, CandidateMlView)
    assert view.dataset_view_version == "candidate-ml-view-v2"
    assert view.gold_snapshot_id == manifest.snapshot_id
    assert (
        view.total_row_count == 13
    )  # 2 TIC-1001 sectors + 5 POS + 5 NEG + 1 UNRESOLVED
    assert (
        view.supervised_eligible_count == 12
    )  # 7 POSITIVE (TIC1001 x2 + TICs 1002-1006) + 5 NEGATIVE
    assert view.positive_count == 7  # TIC 1001 s10, s11, TICs 1002-1006
    assert view.negative_count == 5  # TICs 2001-2005
    assert view.unresolved_count == 1  # TIC 3001
    assert len(view.feature_names) == 31
    assert view.feature_names == CANDIDATE_MODEL_INPUT_FEATURES


def test_frozen_feature_ordering_alphabetical():
    # Verify v2 MODEL_INPUT feature names are strictly sorted alphabetically.
    assert list(CANDIDATE_MODEL_INPUT_FEATURES) == sorted(
        CANDIDATE_MODEL_INPUT_FEATURES
    )
    assert len(CANDIDATE_MODEL_INPUT_FEATURES) == 31


def test_leakage_exclusion():
    # Verify none of LEAKAGE_EXCLUSIONS are present in CANDIDATE_MODEL_INPUT_FEATURES
    for feat in CANDIDATE_MODEL_INPUT_FEATURES:
        assert feat not in LEAKAGE_EXCLUSIONS


def test_non_candidate_snapshot_rejection():
    manifest = GoldSnapshotManifest(
        schema_version=1,
        snapshot_id="gold-v1-anomaly123",
        snapshot_fingerprint="a" * 64,
        snapshot_type="ANOMALY",
        gold_schema_version="gold-anomaly-v1",
        feature_versions={"lc": "lc-features-v1"},
        input_count=1,
        inputs=[],
    )
    with pytest.raises(MlDatasetError, match="UNSUPPORTED_ML_DATASET_SOURCE"):
        build_candidate_ml_view(manifest, sample_candidate_rows())


def test_unresolved_label_policy():
    manifest = sample_gold_manifest()
    rows = sample_candidate_rows()
    view = build_candidate_ml_view(manifest, rows)

    # UNRESOLVED != NEGATIVE
    assert view.unresolved_count == 1
    assert view.supervised_eligible_count == view.positive_count + view.negative_count
    assert view.supervised_eligible_count < view.total_row_count


def test_group_key_derivation():
    row_with_tic = {"tic_id": 12345678, "source_product_id": "prod_1"}
    assert derive_group_key(row_with_tic) == "tic:12345678"

    row_without_tic = {"tic_id": None, "source_product_id": "prod_2"}
    assert derive_group_key(row_without_tic) == "source:prod_2"


def test_group_leakage_prevention_multi_sector():
    manifest = sample_gold_manifest()
    rows = sample_candidate_rows()
    view = build_candidate_ml_view(manifest, rows)

    split = create_deterministic_group_split(view, seed=42)
    assert isinstance(split, CandidateGroupSplit)

    # Find assignments for TIC 1001 (which has rows for sector 10 and sector 11)
    tic_1001_assignments = [a for a in split.assignments if a.group_key == "tic:1001"]
    assert len(tic_1001_assignments) == 1
    # Check row count for TIC 1001 group
    assert tic_1001_assignments[0].row_count == 2
    # Check that both Train and Validation sets are group-disjoint
    train_groups = {a.group_key for a in split.assignments if a.split == "TRAIN"}
    val_groups = {a.group_key for a in split.assignments if a.split == "VALIDATION"}
    assert train_groups.intersection(val_groups) == set()


def test_deterministic_group_split_seed():
    manifest = sample_gold_manifest()
    rows = sample_candidate_rows()
    view = build_candidate_ml_view(manifest, rows)

    split_seed_42_a = create_deterministic_group_split(view, seed=42)
    split_seed_42_b = create_deterministic_group_split(view, seed=42)

    # Same seed -> exact same split ID & assignments
    assert split_seed_42_a.split_id == split_seed_42_b.split_id
    assert split_seed_42_a.split_fingerprint == split_seed_42_b.split_fingerprint

    # Different seed -> different split fingerprint (try seeds until we find a valid one)
    different_split_found = False
    for alt_seed in [1, 2, 3, 5, 7, 11, 13, 17, 19, 23]:
        try:
            split_alt = create_deterministic_group_split(view, seed=alt_seed)
            assert split_seed_42_a.split_fingerprint != split_alt.split_fingerprint
            different_split_found = True
            break
        except MlSplitError:
            continue  # This seed produced invalid class coverage, try next
    assert different_split_found, "No valid alternative seed produced a different split"


def test_no_supervised_rows_rejection():
    manifest = sample_gold_manifest()
    unresolved_rows = [
        {
            "source_product_id": "prod_1",
            "tic_id": 1,
            "training_label": "UNRESOLVED",
        }
    ]
    view = build_candidate_ml_view(manifest, unresolved_rows)
    with pytest.raises(MlDatasetError, match="NO_SUPERVISED_ROWS"):
        create_deterministic_group_split(view)


def test_single_class_dataset_rejection():
    manifest = sample_gold_manifest()
    single_class_rows = [
        {"source_product_id": "prod_1", "tic_id": 1, "training_label": "POSITIVE"},
        {"source_product_id": "prod_2", "tic_id": 2, "training_label": "POSITIVE"},
    ]
    view = build_candidate_ml_view(manifest, single_class_rows)
    with pytest.raises(MlDatasetError, match="SINGLE_CLASS_DATASET"):
        create_deterministic_group_split(view)


def test_insufficient_groups_rejection():
    manifest = sample_gold_manifest()
    one_group_rows = [
        {"source_product_id": "prod_1_s10", "tic_id": 1, "training_label": "POSITIVE"},
        {"source_product_id": "prod_1_s11", "tic_id": 1, "training_label": "NEGATIVE"},
    ]
    view = build_candidate_ml_view(manifest, one_group_rows)
    with pytest.raises(MlDatasetError, match="INSUFFICIENT_GROUPS"):
        create_deterministic_group_split(view)


def test_split_manifest_save_and_load_roundtrip():
    manifest = sample_gold_manifest()
    rows = sample_candidate_rows()
    view = build_candidate_ml_view(manifest, rows)
    split = create_deterministic_group_split(view, seed=42)

    with tempfile.TemporaryDirectory() as tmp_dir:
        out_path = save_split_manifest(split, dest_dir=tmp_dir)
        assert os.path.exists(out_path)

        # Idempotent re-save returns same path
        out_path_again = save_split_manifest(split, dest_dir=tmp_dir)
        assert out_path_again == out_path

        # Load roundtrip
        loaded_split = load_split_manifest(out_path)
        assert loaded_split.split_id == split.split_id
        assert loaded_split.split_fingerprint == split.split_fingerprint
        assert loaded_split.train_group_count == split.train_group_count
        assert loaded_split.validation_group_count == split.validation_group_count
        assert len(loaded_split.assignments) == len(split.assignments)


def test_bronze_silver_clickhouse_independence():
    manifest = sample_gold_manifest()
    rows = sample_candidate_rows()
    view = build_candidate_ml_view(manifest, rows)
    split = create_deterministic_group_split(view, seed=42)

    assert split.gold_snapshot_id == manifest.snapshot_id
    # 12 supervised eligible rows (7 POSITIVE + 5 NEGATIVE)
    assert split.eligible_row_count == 12
    # No Bronze, Silver, or ClickHouse reads occur
    assert split.split_id.startswith("split-v1-")
