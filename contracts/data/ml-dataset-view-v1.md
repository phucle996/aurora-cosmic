# ml-dataset-view-v1 — AURORA Candidate ML Dataset View Contract

## Purpose

Defines the canonical model-input schema, feature ordering, and supervision label eligibility rules for constructing machine learning dataset views (`candidate-ml-view-v1`) from committed Gold Candidate snapshots (`gold-candidate-v1`).

## Dataset View Version

`dataset_view_version: "candidate-ml-view-v1"`

## Canonical Input Boundary

Input MUST be an explicit, committed MinIO Gold Candidate snapshot (`gold/snapshots/<snapshot-id>/manifest.json` + Gold Parquet).

Dataset view construction MUST NOT read:
- Raw Bronze FITS objects (`bronze/`)
- Silver Parquet objects (`silver/`)
- ClickHouse analytical tables
- Live MAST/NASA APIs

## Frozen Model Input Features (32 Columns)

Model training pipelines MUST consume exactly the following 32 `MODEL_INPUT` features in frozen alphabetical order:

| Index | Feature Column Name | Arrow Type | Units / Description |
| :---: | :--- | :--- | :--- |
| 1 | `bls_available` | `Boolean` | Flag indicating if Astropy BLS periodogram was evaluated |
| 2 | `bls_depth` | `Float64` | Best BLS transit depth magnitude |
| 3 | `bls_duration` | `Float64` | Best BLS transit duration (days) |
| 4 | `bls_period` | `Float64` | Best BLS orbital period (days) |
| 5 | `bls_power` | `Float64` | Best BLS periodogram power peak |
| 6 | `bls_transit_time` | `Float64` | Best BLS transit epoch center time |
| 7 | `flux_amplitude` | `Float64` | Flux amplitude (95th - 5th percentile) |
| 8 | `flux_kurtosis` | `Float64` | Fisher excess kurtosis of flux |
| 9 | `flux_mad` | `Float64` | Median Absolute Deviation of flux |
| 10 | `flux_mean` | `Float64` | Mean relative flux |
| 11 | `flux_median` | `Float64` | Median relative flux |
| 12 | `flux_rms` | `Float64` | Root Mean Square flux scatter |
| 13 | `flux_robust_sigma` | `Float64` | Robust sigma (`1.4826 * MAD`) |
| 14 | `flux_skewness` | `Float64` | Flux skewness |
| 15 | `flux_std` | `Float64` | Standard deviation of flux |
| 16 | `logg` | `Float64` | Surface gravity logg (cgs) |
| 17 | `max_gap` | `Float64` | Maximum gap between consecutive cadences (days) |
| 18 | `median_cadence` | `Float64` | Median time interval between cadences (days) |
| 19 | `median_flux_err` | `Float64` | Median reported flux uncertainty |
| 20 | `n_points` | `Int64` | Total valid light curve cadence points |
| 21 | `pixel_mad_median` | `Float64` | TPF median of pixel temporal MAD values |
| 22 | `stellar_mass` | `Float64` | Stellar mass (M_sun) |
| 23 | `stellar_radius` | `Float64` | Stellar radius (R_sun) |
| 24 | `teff` | `Float64` | Effective stellar temperature (K) |
| 25 | `tic_available` | `Boolean` | Flag indicating TIC target metadata is present |
| 26 | `time_span` | `Float64` | Total time span of observation (days) |
| 27 | `tmag` | `Float64` | TESS magnitude |
| 28 | `tpf_evidence_available` | `Boolean` | Flag indicating paired TPF evidence is present |
| 29 | `transit_deficit_center_offset_pixels` | `Float64` | Distance from transit deficit centroid to cutout center |
| 30 | `transit_deficit_centroid_col` | `Float64` | Column coordinate of transit deficit centroid |
| 31 | `transit_deficit_centroid_row` | `Float64` | Row coordinate of transit deficit centroid |
| 32 | `transit_deficit_sum` | `Float64` | Total spatial positive transit deficit sum |

## Strict Leakage Exclusion

The following columns MUST NOT be included in model input feature matrices:
- `training_label`, `label_policy_version` (`SUPERVISION` / `AUDIT`)
- `matched_toi_id`, `toi_match_status`, `toi_period_error` (`VETTING_CONTEXT` / `AUDIT`)
- `matched_tce_id`, `tce_match_status` (`VETTING_CONTEXT` / `AUDIT`)
- `source_product_id`, `lineage_id`, `sample_id`, `tic_id`, `sector`, `silver_sha256`, `lc_feature_version`, `lc_feature_fingerprint` (`IDENTITY`)

## Supervision Label Eligibility

- `POSITIVE` -> Supervised eligible (binary target = 1)
- `NEGATIVE` -> Supervised eligible (binary target = 0)
- `UNRESOLVED` -> Not supervised eligible (used for inference / ranking only; `UNRESOLVED != NEGATIVE`)
- `EXCLUDED` -> Not supervised eligible
