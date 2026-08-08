# gold-lightcurve-features-v1 — AURORA Light Curve Scientific Features Data Contract

## Purpose

Durable data contract specifying the scientific feature fields derived from Silver Light Curve Parquet (`silver-lightcurve-v1`) for exoplanet candidate vetting, variability analysis, and anomaly detection.

## Schema Version

`feature_version: "lc-features-v1"`

## Invariants

1. **Silver-Only Input**: Scientific features are derived strictly from Silver Light Curve Parquet files and permanent Lineage records. Raw Bronze FITS files are NEVER accessed.
2. **Determinism**: Given the same Silver Light Curve input and identical scientific configuration parameters, feature extraction MUST produce identical feature values and `feature_fingerprint`.
3. **No Planet Confirmation Score**: Features are deterministic analytical and statistical observations (e.g. BLS transit-dip evidence), NOT planet probability or confirmation scores.
4. **Missing Values**: Uncomputable or missing features (e.g. BLS metrics on a short light curve) MUST use `null`/`NaN` representation rather than zero (`0`).
5. **No Hidden Detrending**: Features are computed on Silver flux as normalized by Stage 3. Stage 3 quality filtering and normalization are not repeated.

## Feature Record Schema

### 1. Identity & Provenance Fields

| Field | Type | Nullable | Description |
| :--- | :--- | :---: | :--- |
| `lineage_id` | string | | SHA256 hex digest of the upstream Lineage record. |
| `source_product_id` | string | | Original NASA/MAST source product identifier. |
| `sample_id` | string | ✓ | Optional TIC/sector pairing sample identifier (e.g. `"tic:12345678:s:1"`). |
| `tic_id` | integer | ✓ | TESS Input Catalog ID if available. |
| `sector` | integer | ✓ | TESS observing sector number. |
| `processor_version` | string | | Preprocessor version (e.g. `"lc-preprocess-v1"`). |
| `silver_schema_version` | string | | Silver schema version (e.g. `"silver-lightcurve-v1"`). |
| `silver_sha256` | string | | SHA-256 hex digest of Silver Parquet artifact bytes. |
| `feature_version` | string | | Feature schema version. Currently `"lc-features-v1"`. |
| `feature_fingerprint` | string | | SHA-256 hex digest of `(feature_version + canonical_scientific_config)`. |
| `feature_status` | string | | Execution status: `"SUCCESS"`, `"PARTIAL"`, `"INSUFFICIENT_BASELINE"`, or `"INVALID_INPUT"`. |

### 2. Time Coverage & Quality Fields

| Field | Type | Nullable | Unit | Description |
| :--- | :--- | :---: | :---: | :--- |
| `n_points` | integer | | rows | Count of cadence rows used in feature computation. |
| `time_min` | float64 | | days | Minimum observed time coordinate. |
| `time_max` | float64 | | days | Maximum observed time coordinate. |
| `time_span` | float64 | | days | Total baseline duration (`time_max - time_min`). |
| `median_cadence` | float64 | | days | Median sampling interval between consecutive observations. |
| `max_gap` | float64 | | days | Maximum observational gap between consecutive cadences. |

### 3. Distribution & Variability Fields

| Field | Type | Nullable | Unit | Description |
| :--- | :--- | :---: | :---: | :--- |
| `flux_mean` | float64 | | norm_flux | Mean normalized flux. |
| `flux_median` | float64 | | norm_flux | Median normalized flux. |
| `flux_std` | float64 | | norm_flux | Population standard deviation (`ddof=0`). |
| `flux_mad` | float64 | | norm_flux | Raw Median Absolute Deviation (`median(\|flux - median(flux)\|)`). |
| `flux_robust_sigma` | float64 | | norm_flux | Robust scatter estimate (`1.4826 * flux_mad`). |
| `flux_amplitude` | float64 | | norm_flux | Robust 90% amplitude range (`p95 - p05`). |
| `flux_rms` | float64 | | norm_flux | Root Mean Square of normalized flux (`sqrt(mean(flux^2))`). |
| `flux_skewness` | float64 | ✓ | dimensionless | Sample skewness of normalized flux distribution. |
| `flux_kurtosis` | float64 | ✓ | dimensionless | Fisher excess kurtosis of normalized flux distribution. |

### 4. Flux Error Fields

| Field | Type | Nullable | Unit | Description |
| :--- | :--- | :---: | :---: | :--- |
| `median_flux_err` | float64 | ✓ | norm_flux | Median flux uncertainty (null if `flux_err` is missing). |
| `mean_flux_err` | float64 | ✓ | norm_flux | Mean flux uncertainty (null if `flux_err` is missing). |

### 5. Box Least Squares (BLS) Transit Evidence Fields

| Field | Type | Nullable | Unit | Description |
| :--- | :--- | :---: | :---: | :--- |
| `bls_available` | boolean | | | `true` if BLS search ran successfully, `false` otherwise. |
| `bls_period` | float64 | ✓ | days | Best-fit periodic dip search period. |
| `bls_duration` | float64 | ✓ | days | Best-fit transit dip duration. |
| `bls_transit_time` | float64 | ✓ | days | Epoch / midpoint time of detected transit dip. |
| `bls_depth` | float64 | ✓ | norm_flux | Estimated transit dip depth magnitude (positive value). |
| `bls_power` | float64 | ✓ | dimensionless | Maximum BLS periodogram power score. |

## Example Feature Record

```json
{
  "lineage_id": "a3f2c8d1928014819028",
  "source_product_id": "tess-lc-12345678-s0001-0120",
  "sample_id": "tic:12345678:s:1",
  "tic_id": 12345678,
  "sector": 1,
  "processor_version": "lc-preprocess-v1",
  "silver_schema_version": "silver-lightcurve-v1",
  "silver_sha256": "c4ca4238a0b923820dcc509a6f75849b",
  "feature_version": "lc-features-v1",
  "feature_fingerprint": "7f8b920148...29481029",
  "feature_status": "SUCCESS",
  "n_points": 18342,
  "time_min": 1325.21,
  "time_max": 1352.45,
  "time_span": 27.24,
  "median_cadence": 0.00138889,
  "max_gap": 1.25,
  "flux_mean": 0.000012,
  "flux_median": 0.000000,
  "flux_std": 0.001245,
  "flux_mad": 0.000850,
  "flux_robust_sigma": 0.001260,
  "flux_amplitude": 0.004120,
  "flux_rms": 0.001245,
  "flux_skewness": -0.845,
  "flux_kurtosis": 4.120,
  "median_flux_err": 0.000450,
  "mean_flux_err": 0.000455,
  "bls_available": true,
  "bls_period": 3.524,
  "bls_duration": 0.125,
  "bls_transit_time": 1326.15,
  "bls_depth": 0.00350,
  "bls_power": 0.8542
}
```
