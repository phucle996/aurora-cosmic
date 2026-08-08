-- AURORA ClickHouse Database & Idempotent Analytical Table Initialization

CREATE DATABASE IF NOT EXISTS aurora;

-- Snapshot Registry Table
CREATE TABLE IF NOT EXISTS aurora.gold_snapshots_v1 (
    snapshot_id String,
    snapshot_type LowCardinality(String),
    snapshot_fingerprint String,
    gold_schema_version LowCardinality(String),
    manifest_key String,
    manifest_sha256 String,
    expected_row_count Int64,
    indexed_row_count Int64,
    indexed_at DateTime DEFAULT now(),
    index_status LowCardinality(String)
)
ENGINE = MergeTree()
PRIMARY KEY (snapshot_id)
ORDER BY (snapshot_id);

-- Candidate Gold Features Projection Table
CREATE TABLE IF NOT EXISTS aurora.candidate_features_v1 (
    snapshot_id String,
    source_product_id String,
    lineage_id String,
    sample_id Nullable(String),
    tic_id Nullable(Int64),
    sector Int32,
    silver_sha256 String,
    lc_feature_version LowCardinality(String),
    lc_feature_fingerprint String,

    -- LC Features
    n_points Int64,
    time_span Float64,
    median_cadence Float64,
    max_gap Float64,
    flux_mean Float64,
    flux_median Float64,
    flux_std Float64,
    flux_mad Float64,
    flux_robust_sigma Float64,
    flux_amplitude Float64,
    flux_rms Float64,
    flux_skewness Float64,
    flux_kurtosis Float64,
    median_flux_err Nullable(Float64),
    bls_available UInt8,
    bls_period Nullable(Float64),
    bls_duration Nullable(Float64),
    bls_transit_time Nullable(Float64),
    bls_depth Nullable(Float64),
    bls_power Nullable(Float64),

    -- TPF Evidence
    tpf_evidence_available UInt8,
    pixel_mad_median Nullable(Float64),
    variability_peak_fraction Nullable(Float64),
    transit_evidence_available UInt8,
    transit_deficit_sum Nullable(Float64),
    transit_deficit_centroid_row Nullable(Float64),
    transit_deficit_centroid_col Nullable(Float64),
    transit_deficit_center_offset_pixels Nullable(Float64),

    -- TIC Context
    tic_available UInt8,
    tmag Nullable(Float64),
    teff Nullable(Float64),
    stellar_radius Nullable(Float64),
    stellar_mass Nullable(Float64),
    logg Nullable(Float64),

    -- Supervision & Audit
    matched_toi_id Nullable(String),
    toi_match_status LowCardinality(String),
    toi_period_error Nullable(Float64),
    matched_tce_id Nullable(String),
    tce_match_status LowCardinality(String),
    training_label LowCardinality(String),
    label_policy_version LowCardinality(String)
)
ENGINE = MergeTree()
PARTITION BY snapshot_id
PRIMARY KEY (snapshot_id, sector, source_product_id)
ORDER BY (snapshot_id, sector, source_product_id);

-- Anomaly Light Curve Projection Table
CREATE TABLE IF NOT EXISTS aurora.anomaly_lightcurve_v1 (
    snapshot_id String,
    lineage_id String,
    source_product_id String,
    product_kind LowCardinality(String),
    silver_schema_version LowCardinality(String),
    silver_sha256 String,
    processor_version LowCardinality(String),
    feature_version LowCardinality(String),
    feature_fingerprint String,
    feature_status LowCardinality(String),
    sample_id Nullable(String),
    tic_id Nullable(Int64),
    sector Int32,
    n_points Int64,
    time_min Float64,
    time_max Float64,
    time_span Float64,
    median_cadence Float64,
    max_gap Float64,
    flux_mean Float64,
    flux_median Float64,
    flux_std Float64,
    flux_mad Float64,
    flux_robust_sigma Float64,
    flux_amplitude Float64,
    flux_rms Float64,
    flux_skewness Float64,
    flux_kurtosis Float64,
    median_flux_err Nullable(Float64),
    mean_flux_err Nullable(Float64),
    bls_available UInt8,
    bls_period Nullable(Float64),
    bls_duration Nullable(Float64),
    bls_transit_time Nullable(Float64),
    bls_depth Nullable(Float64),
    bls_power Nullable(Float64)
)
ENGINE = MergeTree()
PARTITION BY snapshot_id
PRIMARY KEY (snapshot_id, sector, source_product_id)
ORDER BY (snapshot_id, sector, source_product_id);

-- Anomaly TPF Projection Table
CREATE TABLE IF NOT EXISTS aurora.anomaly_tpf_v1 (
    snapshot_id String,
    lineage_id String,
    source_product_id String,
    product_kind LowCardinality(String),
    silver_schema_version LowCardinality(String),
    silver_sha256 String,
    processor_version LowCardinality(String),
    tpf_feature_version LowCardinality(String),
    tpf_feature_fingerprint String,
    tpf_feature_status LowCardinality(String),
    sample_id Nullable(String),
    tic_id Nullable(Int64),
    sector Int32,
    n_cadences Int64,
    rows Int32,
    cols Int32,
    pixel_count Int32,
    finite_pixel_fraction Float64,
    pixel_mad_median Nullable(Float64),
    pixel_mad_mean Nullable(Float64),
    pixel_mad_max Nullable(Float64),
    variability_peak_fraction Nullable(Float64),
    variability_effective_pixels Nullable(Float64),
    summed_flux_std Nullable(Float64),
    summed_flux_mad Nullable(Float64),
    summed_flux_p05 Nullable(Float64),
    summed_flux_p95 Nullable(Float64),
    transit_evidence_available UInt8,
    transit_in_cadences Int32,
    transit_out_cadences Int32,
    transit_deficit_sum Nullable(Float64),
    transit_deficit_peak_fraction Nullable(Float64),
    transit_deficit_effective_pixels Nullable(Float64),
    transit_deficit_centroid_row Nullable(Float64),
    transit_deficit_centroid_col Nullable(Float64),
    transit_deficit_center_offset_pixels Nullable(Float64)
)
ENGINE = MergeTree()
PARTITION BY snapshot_id
PRIMARY KEY (snapshot_id, sector, source_product_id)
ORDER BY (snapshot_id, sector, source_product_id);

-- Anomaly FFI Projection Table
CREATE TABLE IF NOT EXISTS aurora.anomaly_ffi_v1 (
    snapshot_id String,
    lineage_id String,
    source_product_id String,
    sector Int32,
    camera Int32,
    ccd Int32,
    processor_version LowCardinality(String),
    silver_schema_version LowCardinality(String),
    silver_sha256 String,
    ffi_feature_version LowCardinality(String),
    ffi_feature_fingerprint String,
    ffi_feature_status LowCardinality(String),
    ffi_width Int32,
    ffi_height Int32,
    ffi_finite_pixel_count Int64,
    ffi_finite_pixel_fraction Float64,
    ffi_median Float64,
    ffi_mean Float64,
    ffi_stddev Float64,
    ffi_min Float64,
    ffi_max Float64,
    ffi_dynamic_range Float64,
    cutout_evidence_available UInt8,
    cutout_count Int32,
    cutout_deviation_sum Nullable(Float64),
    cutout_peak_deviation_fraction Nullable(Float64),
    cutout_deviation_effective_pixels Nullable(Float64),
    border_median Nullable(Float64),
    border_mad Nullable(Float64),
    center_deviation_fraction Nullable(Float64)
)
ENGINE = MergeTree()
PARTITION BY snapshot_id
PRIMARY KEY (snapshot_id, sector, camera, ccd, source_product_id)
ORDER BY (snapshot_id, sector, camera, ccd, source_product_id);
