-- AURORA ClickHouse Database & Idempotent Analytical Table Initialization

CREATE DATABASE IF NOT EXISTS aurora;

-- API serving tables. Writers must insert only validated prediction records;
-- the Go API never substitutes synthetic records when these tables are empty.
CREATE TABLE IF NOT EXISTS aurora.candidate_predictions (
    prediction_id String,
    source_product_id String,
    tic_id Int64,
    sector Int32,
    raw_logit Float64,
    candidate_score Float64,
    decision_threshold Float64,
    above_threshold Bool,
    model_version LowCardinality(String),
    registered_model_id String DEFAULT '',
    gold_snapshot_id String DEFAULT '',
    runtime_validation_id String DEFAULT '',
    runtime_package_id String,
    predicted_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(predicted_at)
PARTITION BY sector
ORDER BY (sector, prediction_id);

CREATE TABLE IF NOT EXISTS aurora.anomaly_predictions (
    prediction_id String,
    source_product_id String,
    tic_id Int64,
    sector Int32,
    reconstruction_mse Float64,
    decision_threshold Float64,
    above_threshold Bool,
    model_version LowCardinality(String),
    registered_model_id String DEFAULT '',
    gold_snapshot_id String DEFAULT '',
    runtime_validation_id String DEFAULT '',
    runtime_package_id String,
    predicted_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(predicted_at)
PARTITION BY sector
ORDER BY (sector, prediction_id);

-- Additive compatibility migration for databases initialized before the
-- prediction-v1 lineage fields were introduced. Safe to run repeatedly.
ALTER TABLE aurora.candidate_predictions ADD COLUMN IF NOT EXISTS registered_model_id String DEFAULT '' AFTER model_version;
ALTER TABLE aurora.candidate_predictions ADD COLUMN IF NOT EXISTS gold_snapshot_id String DEFAULT '' AFTER registered_model_id;
ALTER TABLE aurora.candidate_predictions ADD COLUMN IF NOT EXISTS runtime_validation_id String DEFAULT '' AFTER gold_snapshot_id;
ALTER TABLE aurora.anomaly_predictions ADD COLUMN IF NOT EXISTS registered_model_id String DEFAULT '' AFTER model_version;
ALTER TABLE aurora.anomaly_predictions ADD COLUMN IF NOT EXISTS gold_snapshot_id String DEFAULT '' AFTER registered_model_id;
ALTER TABLE aurora.anomaly_predictions ADD COLUMN IF NOT EXISTS runtime_validation_id String DEFAULT '' AFTER gold_snapshot_id;

CREATE TABLE IF NOT EXISTS aurora.targets (
    tic_id Int64,
    tess_mag Float64,
    ra Float64,
    dec Float64,
    effective_t Float64,
    surface_grav Float64,
    radius Float64,
    sector Int32,
    matched_toi Nullable(String),
    disposition LowCardinality(String),
    updated_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(updated_at)
PARTITION BY sector
ORDER BY (sector, tic_id);

CREATE TABLE IF NOT EXISTS aurora.lightcurves (
    tic_id Int64,
    sector Int32,
    time Float64,
    flux Float64,
    observed_at DateTime DEFAULT now()
)
ENGINE = MergeTree()
PARTITION BY sector
ORDER BY (tic_id, time);

-- Rebuildable exact plot samples sourced from checksum-verified Silver LC
-- Parquet. Gold keeps feature tables; this is only the visualization index.
CREATE TABLE IF NOT EXISTS aurora.lightcurve_samples_v1 (
    source_product_id String,
    silver_sha256 String,
    tic_id Int64,
    sector Int32,
    time Float64,
    flux Float64,
    projected_at DateTime64(3, 'UTC')
)
ENGINE = ReplacingMergeTree(projected_at)
PARTITION BY sector
ORDER BY (sector, tic_id, source_product_id, silver_sha256, time);

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

-- Durable Data Factory operational history. Gold Builder writes observed
-- lifecycle and batch facts; the dashboard never derives historical runs.
CREATE TABLE IF NOT EXISTS aurora.pipeline_runs_v1 (
    pipeline LowCardinality(String),
    run_id String,
    mode LowCardinality(String),
    status LowCardinality(String),
    started_at DateTime64(3, 'UTC'),
    finished_at Nullable(DateTime64(3, 'UTC')),
    max_batch_records UInt32,
    idle_flush_seconds UInt32,
    pending_inputs UInt64,
    active_builds UInt32,
    completed_batches UInt32,
    input_records UInt64,
    output_rows UInt64,
    indexed_rows UInt64,
    last_snapshot_id String,
    last_error String,
    updated_at DateTime64(3, 'UTC')
)
ENGINE = ReplacingMergeTree(updated_at)
PARTITION BY toYYYYMM(started_at)
ORDER BY (pipeline, run_id);

CREATE TABLE IF NOT EXISTS aurora.pipeline_batches_v1 (
    pipeline LowCardinality(String),
    run_id String,
    batch_id String,
    mode LowCardinality(String),
    status LowCardinality(String),
    started_at DateTime64(3, 'UTC'),
    completed_at Nullable(DateTime64(3, 'UTC')),
    input_records UInt64,
    candidate_rows UInt64,
    artifact_count UInt32,
    indexed_rows UInt64,
    snapshot_id String,
    snapshot_fingerprint String,
    manifest_key String,
    manifest_sha256 String,
    error String,
    updated_at DateTime64(3, 'UTC')
)
ENGINE = ReplacingMergeTree(updated_at)
PARTITION BY toYYYYMM(started_at)
ORDER BY (pipeline, run_id, batch_id);

CREATE TABLE IF NOT EXISTS aurora.pipeline_component_events_v1 (
    pipeline LowCardinality(String),
    run_id String,
    component_id LowCardinality(String),
    status LowCardinality(String),
    occurred_at DateTime64(3, 'UTC'),
    input_records UInt64,
    output_rows UInt64,
    indexed_rows UInt64,
    snapshot_id String,
    error String
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (pipeline, run_id, occurred_at, component_id);

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
    pixel_mad_median Nullable(Float64),
    variability_peak_fraction Nullable(Float64),
    transit_evidence_available UInt8,
    transit_deficit_sum Nullable(Float64),
    transit_deficit_centroid_row Nullable(Float64),
    transit_deficit_centroid_col Nullable(Float64),
    transit_deficit_center_offset_pixels Nullable(Float64),

    -- TIC Context
    tic_available UInt8,
    ra_deg Nullable(Float64),
    dec_deg Nullable(Float64),
    tmag Nullable(Float64),
    teff Nullable(Float64),
    stellar_radius Nullable(Float64),
    stellar_mass Nullable(Float64),
    logg Nullable(Float64),

    -- TOI evidence. Curated labels/TCE evidence are stored in a separate
    -- training cohort rather than copied as constants into Candidate Gold.
    matched_toi_id Nullable(String),
    toi_match_status LowCardinality(String),
    toi_period_error Nullable(Float64)
)
ENGINE = MergeTree()
PARTITION BY snapshot_id
PRIMARY KEY (snapshot_id, sector, source_product_id)
ORDER BY (snapshot_id, sector, source_product_id);

-- Candidate rows are already complete at Gold commit time. This view remains
-- as a stable query contract for the API, without a mutable enrichment overlay.
CREATE OR REPLACE VIEW aurora.candidate_features_current_v1 AS
SELECT * FROM aurora.candidate_features_v1;

-- Reviewable labels are a separate control-plane cohort. They never mutate
-- Candidate Gold discovery evidence and may be overridden by a reviewer.
CREATE TABLE IF NOT EXISTS aurora.candidate_training_cohort_v1 (
    snapshot_id String,
    source_product_id String,
    tic_id Int64,
    sector Int32,
    training_label LowCardinality(String),
    confidence Float64,
    label_source LowCardinality(String),
    review_status LowCardinality(String),
    train_eligible UInt8,
    policy_version String,
    evidence_json String,
    review_reason String DEFAULT '',
    updated_at DateTime64(3, 'UTC')
)
ENGINE = ReplacingMergeTree(updated_at)
PARTITION BY snapshot_id
ORDER BY (snapshot_id, source_product_id);

ALTER TABLE aurora.candidate_training_cohort_v1
    ADD COLUMN IF NOT EXISTS review_reason String DEFAULT '' AFTER evidence_json;

-- Scientific adjudication belongs to the research workflow, not to the
-- supervised-training label overlay. ReplacingMergeTree keeps the latest
-- decision while preserving immutable candidate and Gold records.
CREATE TABLE IF NOT EXISTS aurora.candidate_scientific_reviews_v1 (
    snapshot_id String,
    prediction_id String,
    source_product_id String,
    tic_id Int64,
    sector Int32,
    scientific_decision LowCardinality(String),
    review_status LowCardinality(String),
    reviewer String,
    review_note String,
    updated_at DateTime64(3, 'UTC')
)
ENGINE = ReplacingMergeTree(updated_at)
PARTITION BY snapshot_id
ORDER BY (snapshot_id, prediction_id);

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

-- Deterministic planet-physics projection. The Go API currently derives this
-- read model from candidate evidence; materializers can persist identical rows
-- here without changing the API contract.
CREATE TABLE IF NOT EXISTS aurora.planet_physics_v1 (
    planet_candidate_id String,
    prediction_id String,
    gold_snapshot_id String,
    tic_id Int64,
    sector Int32,
    source_product_id String,
    physics_model_version LowCardinality(String),
    orbital_period_days Nullable(Float64),
    transit_depth_fraction Nullable(Float64),
    planet_radius_earth Nullable(Float64),
    semi_major_axis_au Nullable(Float64),
    stellar_luminosity_solar Nullable(Float64),
    insolation_earth Nullable(Float64),
    equilibrium_temperature_k Nullable(Float64),
    bond_albedo_assumption Float64,
    hz_classification LowCardinality(String),
    input_completeness Float64,
    warnings Array(String),
    calculated_at DateTime64(3, 'UTC')
)
ENGINE = ReplacingMergeTree(calculated_at)
PARTITION BY gold_snapshot_id
PRIMARY KEY (gold_snapshot_id, planet_candidate_id)
ORDER BY (gold_snapshot_id, planet_candidate_id);

CREATE TABLE IF NOT EXISTS aurora.habitability_assessments_v1 (
    planet_candidate_id String,
    prediction_id String,
    gold_snapshot_id String,
    assessment_version LowCardinality(String),
    status LowCardinality(String),
    physics_score Nullable(Float64),
    confidence Float64,
    tier LowCardinality(String),
    component_keys Array(String),
    component_scores Array(Float64),
    component_max_scores Array(Float64),
    component_available Array(UInt8),
    component_reasons Array(String),
    ml_score Nullable(Float64),
    ml_status LowCardinality(String),
    evaluated_at DateTime64(3, 'UTC')
)
ENGINE = ReplacingMergeTree(evaluated_at)
PARTITION BY gold_snapshot_id
PRIMARY KEY (gold_snapshot_id, planet_candidate_id, assessment_version)
ORDER BY (gold_snapshot_id, planet_candidate_id, assessment_version);

-- Lakehouse Object Storage Catalog Index (Sub-millisecond S3 metadata lookup)
CREATE TABLE IF NOT EXISTS aurora.lakehouse_objects (
    tier LowCardinality(String),
    object_key String,
    size_bytes Int64,
    etag String,
    sector Int32,
    tic_id Int64,
    product_type LowCardinality(String),
    last_modified DateTime,
    indexed_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(last_modified)
PRIMARY KEY (tier, sector, tic_id, object_key)
ORDER BY (tier, sector, tic_id, object_key);
