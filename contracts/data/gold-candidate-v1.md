# gold-candidate-v1 — AURORA Materialized Exoplanet Candidate Gold Schema Contract

## Purpose

Durable schema contract for final joined candidate Gold Parquet datasets materialized under `gold/snapshots/<snapshot-id>/data/candidate/sector=XXXX/part-00000.parquet`.

## Schema Version

`gold_schema_version: "gold-candidate-v1"`

## Storage Partition Layout

```text
gold/
└── snapshots/
    └── <snapshot-id>/
        ├── manifest.json
        └── data/
            └── candidate/
                ├── sector=0001/
                │   └── part-00000.parquet
                ├── sector=0002/
                │   └── part-00000.parquet
                └── ...
```

## Column Schema & Column-Role Classification

| Column Name | Arrow Type | Nullable | Role | Description |
| :--- | :--- | :---: | :--- | :--- |
| `source_product_id` | `Utf8` | No | `IDENTITY` | NASA/MAST source light curve product ID. |
| `lineage_id` | `Utf8` | No | `IDENTITY` | Upstream Silver lineage ID. |
| `sample_id` | `Utf8` | Yes | `IDENTITY` | TIC/sector sample identifier. |
| `tic_id` | `Int64` | Yes | `IDENTITY` | TESS Input Catalog ID. |
| `sector` | `Int32` | No | `IDENTITY` | TESS observing sector number. |
| `silver_sha256` | `Utf8` | No | `IDENTITY` | SHA-256 digest of source Silver Parquet artifact. |
| `lc_feature_version` | `Utf8` | No | `IDENTITY` | Light curve feature schema version (`"lc-features-v1"`). |
| `lc_feature_fingerprint` | `Utf8` | No | `IDENTITY` | SHA-256 fingerprint of LC feature config. |
| `n_points` | `Int64` | No | `MODEL_INPUT` | Total valid light curve cadence points. |
| `time_span` | `Float64` | No | `MODEL_INPUT` | Time span of observation (days). |
| `median_cadence` | `Float64` | No | `MODEL_INPUT` | Median time interval between cadences (days). |
| `max_gap` | `Float64` | No | `MODEL_INPUT` | Maximum gap between consecutive cadences (days). |
| `flux_mean` | `Float64` | No | `MODEL_INPUT` | Mean relative flux. |
| `flux_median` | `Float64` | No | `MODEL_INPUT` | Median relative flux. |
| `flux_std` | `Float64` | No | `MODEL_INPUT` | Standard deviation of flux. |
| `flux_mad` | `Float64` | No | `MODEL_INPUT` | Median Absolute Deviation of flux. |
| `flux_robust_sigma` | `Float64` | No | `MODEL_INPUT` | Robust sigma (`1.4826 * MAD`). |
| `flux_amplitude` | `Float64` | No | `MODEL_INPUT` | Flux amplitude (`p95 - p05`). |
| `flux_rms` | `Float64` | No | `MODEL_INPUT` | Root Mean Square flux scatter. |
| `flux_skewness` | `Float64` | No | `MODEL_INPUT` | Flux skewness. |
| `flux_kurtosis` | `Float64` | No | `MODEL_INPUT` | Fisher excess kurtosis. |
| `median_flux_err` | `Float64` | Yes | `MODEL_INPUT` | Median reported flux uncertainty. |
| `bls_available` | `Boolean` | No | `MODEL_INPUT` | Flag indicating if Astropy BLS was evaluated. |
| `bls_period` | `Float64` | Yes | `MODEL_INPUT` | Best BLS period (days). |
| `bls_duration` | `Float64` | Yes | `MODEL_INPUT` | Best BLS transit duration (days). |
| `bls_transit_time` | `Float64` | Yes | `MODEL_INPUT` | Best BLS transit epoch center time. |
| `bls_depth` | `Float64` | Yes | `MODEL_INPUT` | Best BLS transit depth magnitude. |
| `bls_power` | `Float64` | Yes | `MODEL_INPUT` | Best BLS periodogram power peak. |
| `tpf_evidence_available` | `Boolean` | No | `MODEL_INPUT` | Flag indicating if paired TPF evidence is present. |
| `pixel_mad_median` | `Float64` | Yes | `MODEL_INPUT` | TPF median of pixel temporal MAD values. |
| `variability_peak_fraction` | `Float64` | Yes | `MODEL_INPUT` | TPF variability peak concentration ratio. |
| `transit_evidence_available` | `Boolean` | No | `MODEL_INPUT` | Flag indicating candidate transit-window deficit is present. |
| `transit_deficit_sum` | `Float64` | Yes | `MODEL_INPUT` | Total spatial positive transit deficit sum. |
| `transit_deficit_centroid_row` | `Float64` | Yes | `MODEL_INPUT` | Row coordinate of transit deficit centroid. |
| `transit_deficit_centroid_col` | `Float64` | Yes | `MODEL_INPUT` | Column coordinate of transit deficit centroid. |
| `transit_deficit_center_offset_pixels` | `Float64` | Yes | `MODEL_INPUT` | Distance from transit deficit centroid to cutout center. |
| `tic_available` | `Boolean` | No | `MODEL_INPUT` | Flag indicating TIC target metadata is present. |
| `tmag` | `Float64` | Yes | `MODEL_INPUT` | TESS magnitude. |
| `teff` | `Float64` | Yes | `MODEL_INPUT` | Effective stellar temperature (K). |
| `stellar_radius` | `Float64` | Yes | `MODEL_INPUT` | Stellar radius (R_sun). |
| `stellar_mass` | `Float64` | Yes | `MODEL_INPUT` | Stellar mass (M_sun). |
| `logg` | `Float64` | Yes | `MODEL_INPUT` | Surface gravity logg (cgs). |
| `matched_toi_id` | `Utf8` | Yes | `AUDIT` | Matched TOI candidate identifier. |
| `toi_match_status` | `Utf8` | No | `VETTING_CONTEXT` | TOI ephemeris match status (`EPHEMERIS_MATCH`, `PERIOD_ONLY`, `NO_MATCH`, `AMBIGUOUS`). |
| `toi_period_error` | `Float64` | Yes | `AUDIT` | Relative period error between BLS and catalog TOI. |
| `matched_tce_id` | `Utf8` | Yes | `AUDIT` | Matched TCE pipeline detection identifier. |
| `tce_match_status` | `Utf8` | No | `VETTING_CONTEXT` | TCE ephemeris match status. |
| `training_label` | `Utf8` | No | `SUPERVISION` | Conservative label (`POSITIVE`, `NEGATIVE`, `UNRESOLVED`, `EXCLUDED`). |
| `label_policy_version` | `Utf8` | No | `AUDIT` | Label policy version (`"candidate-label-policy-v1"`). |

## Leakage Prevention Rule

Supervised ML models in Stage 6 MUST filter input features using `Role == "MODEL_INPUT"`. Columns tagged `SUPERVISION`, `AUDIT`, or `VETTING_CONTEXT` MUST NOT be passed to model training.
