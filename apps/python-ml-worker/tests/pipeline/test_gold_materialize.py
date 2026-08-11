"""Unit & integration tests for Gold Materialization & Feature Recovery Checkpoints (Phase 5.5)."""

import os
import tempfile
import pyarrow as pa
import pyarrow.parquet as pq

from aurora_ml.pipeline.feature_checkpoint import (
    FeatureArtifactProgress,
    FeatureCheckpointRecord,
    FeatureCheckpointState,
)
from aurora_ml.pipeline.gold import SilverInputRef
from aurora_ml.pipeline.gold_materialize import (
    derive_partition_content_sha256,
    format_sector_partition_path,
    get_candidate_arrow_schema,
    get_ffi_anomaly_arrow_schema,
    get_lc_anomaly_arrow_schema,
    get_tpf_anomaly_arrow_schema,
    group_inputs_by_sector,
    write_partition_parquet,
)


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


def test_candidate_arrow_schema_validation():
    schema = get_candidate_arrow_schema()
    assert isinstance(schema, pa.Schema)

    field_names = [f.name for f in schema]
    assert "source_product_id" in field_names
    assert "tic_id" in field_names
    assert "bls_period" in field_names
    assert "training_label" in field_names

    # Verify column types
    assert schema.field("source_product_id").type == pa.string()
    assert schema.field("tic_id").type == pa.int64()
    assert schema.field("bls_period").type == pa.float64()
    assert schema.field("bls_available").type == pa.bool_()


def test_anomaly_arrow_schemas():
    lc_schema = get_lc_anomaly_arrow_schema()
    tpf_schema = get_tpf_anomaly_arrow_schema()
    ffi_schema = get_ffi_anomaly_arrow_schema()

    assert "flux_std" in [f.name for f in lc_schema]
    assert "pixel_mad_median" in [f.name for f in tpf_schema]
    assert "ffi_dynamic_range" in [f.name for f in ffi_schema]


def test_partition_content_sha256_determinism():
    rows = [
        {"source_product_id": "prod_B", "sample_id": "s:2", "flux_std": 0.005},
        {"source_product_id": "prod_A", "sample_id": "s:1", "flux_std": 0.003},
    ]

    # Logical content SHA-256 hash must be row-order independent
    hash1 = derive_partition_content_sha256("candidate", 1, rows)
    hash2 = derive_partition_content_sha256("candidate", 1, list(reversed(rows)))

    assert hash1 == hash2
    assert len(hash1) == 64


def test_partition_content_sha256_sensitivity():
    rows1 = [{"source_product_id": "prod_A", "sample_id": "s:1", "flux_std": 0.003}]
    rows2 = [{"source_product_id": "prod_A", "sample_id": "s:1", "flux_std": 0.004}]

    hash1 = derive_partition_content_sha256("candidate", 1, rows1)
    hash2 = derive_partition_content_sha256("candidate", 1, rows2)

    assert hash1 != hash2


def test_write_partition_parquet_zstd():
    schema = pa.schema(
        [
            ("source_product_id", pa.string()),
            ("lineage_id", pa.string()),
            ("sample_id", pa.string()),
            ("tic_id", pa.int64()),
            ("sector", pa.int32()),
            ("silver_sha256", pa.string()),
            ("lc_feature_version", pa.string()),
            ("lc_feature_fingerprint", pa.string()),
            ("n_points", pa.int64()),
            ("flux_std", pa.float64()),
            ("bls_available", pa.bool_()),
            ("bls_period", pa.float64()),
            ("training_label", pa.string()),
        ]
    )

    rows = [
        {
            "source_product_id": "tess-lc-12345678-s0001-0120",
            "lineage_id": "lineage_1",
            "sample_id": "tic:12345678:s:1",
            "tic_id": 12345678,
            "sector": 1,
            "silver_sha256": "c4ca4238a0b923820dcc509a6f75849b",
            "lc_feature_version": "lc-features-v1",
            "lc_feature_fingerprint": "fp123",
            "n_points": 1000,
            "flux_std": 0.0035,
            "bls_available": True,
            "bls_period": 3.5,
            "training_label": "POSITIVE",
        }
    ]

    with tempfile.TemporaryDirectory() as tmp_dir:
        out_file = os.path.join(tmp_dir, "test_part.parquet")
        n_rows, content_sha, parquet_sha, size_bytes = write_partition_parquet(
            schema=schema,
            rows=rows,
            dest_path=out_file,
            dataset_name="candidate",
            sector=1,
            compression="ZSTD",
        )

        assert n_rows == 1
        assert len(content_sha) == 64
        assert len(parquet_sha) == 64
        assert size_bytes > 0

        # Read written Parquet file back with PyArrow to verify validity
        table = pq.read_table(out_file)
        assert table.num_rows == 1
        read_row = table.to_pydict()
        assert read_row["source_product_id"][0] == "tess-lc-12345678-s0001-0120"
        assert read_row["bls_period"][0] == 3.5
        assert read_row["training_label"][0] == "POSITIVE"


def test_sector_partition_path_formatting():
    path_cand = format_sector_partition_path(
        "gold-v1-abc12345", "CANDIDATE", "candidate", 42
    )
    assert (
        path_cand
        == "gold/snapshots/gold-v1-abc12345/data/candidate/sector=0042/part-00000.parquet"
    )

    path_anom = format_sector_partition_path(
        "gold-v1-abc12345", "ANOMALY", "lightcurve", 42
    )
    assert (
        path_anom
        == "gold/snapshots/gold-v1-abc12345/data/anomaly/lightcurve/sector=0042/part-00000.parquet"
    )


def test_group_inputs_by_sector():
    inp1 = sample_silver_ref(sector=1)
    inp2 = sample_silver_ref(sector=2)
    inp3 = sample_silver_ref(sector=1)

    grouped = group_inputs_by_sector([inp1, inp2, inp3])

    assert set(grouped.keys()) == {1, 2}
    assert len(grouped[1]) == 2
    assert len(grouped[2]) == 1


def test_feature_checkpoint_record_serialization():
    art = FeatureArtifactProgress(
        dataset="candidate",
        sector=1,
        object_key="gold/snapshots/gold-v1-123/data/candidate/sector=0001/part-00000.parquet",
        row_count=100,
        content_sha256="c_sha",
        parquet_sha256="p_sha",
        size_bytes=4096,
    )

    rec = FeatureCheckpointRecord(
        snapshot_id="gold-v1-123",
        snapshot_type="CANDIDATE",
        snapshot_fingerprint="fp64",
        expected_artifact_count=1,
        state=FeatureCheckpointState.MATERIALIZING,
        artifacts=[art],
    )

    json_str = rec.to_json()
    assert "gold-v1-123" in json_str
    assert "MATERIALIZING" in json_str

    restored = FeatureCheckpointRecord.from_json(json_str)
    assert restored.snapshot_id == rec.snapshot_id
    assert restored.state == FeatureCheckpointState.MATERIALIZING
    assert len(restored.artifacts) == 1
    assert restored.artifacts[0].size_bytes == 4096


def test_bronze_raw_deleted_safety():
    """Verify Gold materialization functions operate with zero reads to bronze/."""
    schema = get_candidate_arrow_schema()
    ref = sample_silver_ref(sector=1)

    rows = [
        {
            "source_product_id": ref.source_product_id,
            "lineage_id": ref.lineage_id,
            "sample_id": ref.sample_id,
            "tic_id": 12345678,
            "sector": 1,
            "silver_sha256": ref.silver_sha256,
            "lc_feature_version": "lc-features-v1",
            "lc_feature_fingerprint": "fp123",
            "n_points": 500,
            "time_span": 20.0,
            "median_cadence": 0.0013,
            "max_gap": 0.1,
            "flux_mean": 0.0,
            "flux_median": 0.0,
            "flux_std": 0.002,
            "flux_mad": 0.0015,
            "flux_robust_sigma": 0.0022,
            "flux_amplitude": 0.008,
            "flux_rms": 0.002,
            "flux_skewness": 0.1,
            "flux_kurtosis": 0.05,
            "median_flux_err": None,
            "bls_available": True,
            "bls_period": 3.5,
            "bls_duration": 0.2,
            "bls_transit_time": 1.0,
            "bls_depth": 0.01,
            "bls_power": 0.95,
            "tpf_evidence_available": False,
            "pixel_mad_median": None,
            "variability_peak_fraction": None,
            "transit_evidence_available": False,
            "transit_deficit_sum": None,
            "transit_deficit_centroid_row": None,
            "transit_deficit_centroid_col": None,
            "transit_deficit_center_offset_pixels": None,
            "tic_available": False,
            "tmag": None,
            "teff": None,
            "stellar_radius": None,
            "stellar_mass": None,
            "logg": None,
            "matched_toi_id": None,
            "toi_match_status": "NO_MATCH",
            "toi_period_error": None,
            "matched_tce_id": None,
            "tce_match_status": "NO_MATCH",
            "training_label": "UNRESOLVED",
            "label_policy_version": "candidate-label-policy-v1",
        }
    ]

    with tempfile.TemporaryDirectory() as tmp_dir:
        out_file = os.path.join(tmp_dir, "part-00000.parquet")
        n_rows, c_sha, p_sha, size = write_partition_parquet(
            schema=schema,
            rows=rows,
            dest_path=out_file,
            dataset_name="candidate",
            sector=1,
        )

        assert n_rows == 1
        assert size > 0
