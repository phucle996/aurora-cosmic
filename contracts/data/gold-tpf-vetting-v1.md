# gold-tpf-vetting-v1 — AURORA Target Pixel File Vetting Evidence Contract

## Purpose

Durable data contract specifying spatial and vetting evidence fields derived from Silver Target Pixel Parquet (`silver-target-pixel-v1`) and optional candidate ephemeris from `lc-features-v1`.

## Schema Version

`tpf_feature_version: "tpf-vetting-v1"`

## Invariants

1. **Silver-Only Input**: TPF evidence features are derived strictly from Silver Target Pixel Parquet files, permanent Lineage records, and optional `lc-features-v1` ephemeris. Raw Bronze FITS files are NEVER accessed.
2. **Normalized Pixel Photocenter Boundary**: Silver TPF pixel values are normalized (`pixel / median - 1`). Absolute flux photocenter calculation (`sum(x * flux) / sum(flux)`) is mathematically invalid. V1 computes **Transit Deficit Centroid** on nonnegative dimming maps (`max(out_median - in_median, 0)`).
3. **No Planet Confirmation Score**: Features provide deterministic spatial localization evidence for candidate vetting, NOT planet confirmation or probability scores.
4. **Missing Values**: Uncomputable or missing features (e.g. transit deficit metrics when no paired LC or BLS ephemeris exists) MUST use `null`/`NaN` representation rather than zero (`0`).

## Feature Record Schema

### 1. Identity & Provenance Fields

| Field | Type | Nullable | Description |
| :--- | :--- | :---: | :--- |
| `lineage_id` | string | | SHA256 hex digest of upstream TPF Lineage record. |
| `source_product_id` | string | | Original NASA/MAST source product identifier. |
| `sample_id` | string | ✓ | Optional TIC/sector pairing sample identifier (e.g. `"tic:12345678:s:1"`). |
| `tic_id` | integer | ✓ | TESS Input Catalog ID if available. |
| `sector` | integer | ✓ | TESS observing sector number. |
| `processor_version` | string | | Preprocessor version (e.g. `"tpf-preprocess-v1"`). |
| `silver_schema_version` | string | | Silver schema version (e.g. `"silver-target-pixel-v1"`). |
| `silver_sha256` | string | | SHA-256 hex digest of Silver TPF Parquet artifact. |
| `tpf_feature_version` | string | | TPF feature schema version. Currently `"tpf-vetting-v1"`. |
| `tpf_feature_fingerprint` | string | | SHA-256 hex digest of `(tpf_feature_version + canonical_config + lc_dependency)`. |
| `tpf_feature_status` | string | | Status: `"SUCCESS"`, `"PARTIAL"`, `"NO_PAIRED_LC"`, `"NO_BLS_EPHEMERIS"`, `"INSUFFICIENT_TRANSIT_CADENCES"`, `"PAIRING_CONFLICT"`, `"INVALID_INPUT"`. |

### 2. TPF Shape & Data Quality Fields

| Field | Type | Nullable | Description |
| :--- | :--- | :---: | :--- |
| `n_cadences` | integer | | Count of cadence rows in TPF series. |
| `rows` | integer | | Image cutout row dimension. |
| `cols` | integer | | Image cutout column dimension. |
| `pixel_count` | integer | | Total pixels per cadence (`rows * cols`). |
| `finite_pixel_fraction` | float64 | | Ratio of finite pixels across entire TPF data cube. |

### 3. Temporal Variability Summary Fields

| Field | Type | Nullable | Description |
| :--- | :--- | :---: | :--- |
| `pixel_mad_median` | float64 | | Median of per-pixel temporal MAD values. |
| `pixel_mad_mean` | float64 | | Mean of per-pixel temporal MAD values. |
| `pixel_mad_max` | float64 | | Maximum of per-pixel temporal MAD values. |
| `variability_peak_fraction` | float64 | ✓ | Concentration ratio: `max(MAD) / sum(MAD)`. |
| `variability_effective_pixels` | float64 | ✓ | Effective variable pixel count: `(sum(MAD)^2) / sum(MAD^2)`. |

### 4. Summed Relative Flux Fields

| Field | Type | Nullable | Description |
| :--- | :--- | :---: | :--- |
| `summed_flux_std` | float64 | | Standard deviation of spatial sum across cadences. |
| `summed_flux_mad` | float64 | | Median Absolute Deviation of spatial sum across cadences. |
| `summed_flux_p05` | float64 | | 5th percentile of spatial sum series. |
| `summed_flux_p95` | float64 | | 95th percentile of spatial sum series. |

### 5. Candidate Transit-Window Deficit Fields

| Field | Type | Nullable | Unit | Description |
| :--- | :--- | :---: | :---: | :--- |
| `transit_evidence_available` | boolean | | | `true` if candidate ephemeris was successfully applied. |
| `transit_in_cadences` | integer | ✓ | rows | Count of cadences inside candidate transit window. |
| `transit_out_cadences` | integer | ✓ | rows | Count of cadences in guarded out-of-transit baseline. |
| `transit_deficit_sum` | float64 | ✓ | norm_flux | Total spatial sum of positive transit dimming (`sum(max(out - in, 0))`). |
| `transit_deficit_peak_fraction` | float64 | ✓ | dimensionless | Peak concentration of positive deficit map: `max(deficit) / sum(deficit)`. |
| `transit_deficit_effective_pixels` | float64 | ✓ | dimensionless | Effective pixel count of positive deficit map: `(sum(d)^2) / sum(d^2)`. |
| `transit_deficit_centroid_row` | float64 | ✓ | pixels | Row coordinate (0-indexed) of positive transit deficit centroid. |
| `transit_deficit_centroid_col` | float64 | ✓ | pixels | Column coordinate (0-indexed) of positive transit deficit centroid. |
| `transit_deficit_center_offset_pixels` | float64 | ✓ | pixels | Distance from positive deficit centroid to geometric cutout center. |

## Example TPF Feature Record

```json
{
  "lineage_id": "b9f2c8d1928014819030",
  "source_product_id": "tess-tp-12345678-s0001-0120",
  "sample_id": "tic:12345678:s:1",
  "tic_id": 12345678,
  "sector": 1,
  "processor_version": "tpf-preprocess-v1",
  "silver_schema_version": "silver-target-pixel-v1",
  "silver_sha256": "e8ca4238a0b923820dcc509a6f75849d",
  "tpf_feature_version": "tpf-vetting-v1",
  "tpf_feature_fingerprint": "8a9b920148...39481030",
  "tpf_feature_status": "SUCCESS",
  "n_cadences": 18342,
  "rows": 11,
  "cols": 11,
  "pixel_count": 121,
  "finite_pixel_fraction": 1.0,
  "pixel_mad_median": 0.00045,
  "pixel_mad_mean": 0.00052,
  "pixel_mad_max": 0.00350,
  "variability_peak_fraction": 0.0556,
  "variability_effective_pixels": 24.5,
  "summed_flux_std": 0.00420,
  "summed_flux_mad": 0.00380,
  "summed_flux_p05": -0.00850,
  "summed_flux_p95": 0.00620,
  "transit_evidence_available": true,
  "transit_in_cadences": 120,
  "transit_out_cadences": 1240,
  "transit_deficit_sum": 0.0450,
  "transit_deficit_peak_fraction": 0.225,
  "transit_deficit_effective_pixels": 6.8,
  "transit_deficit_centroid_row": 5.12,
  "transit_deficit_centroid_col": 4.95,
  "transit_deficit_center_offset_pixels": 0.13
}
```
