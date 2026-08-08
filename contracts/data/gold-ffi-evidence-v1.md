# gold-ffi-evidence-v1 — AURORA Full Frame Image Context Evidence Contract

## Purpose

Durable data contract specifying image context and cutout evidence fields derived from Silver FFI Parquet (`silver-ffi-v1`).

## Schema Version

`ffi_feature_version: "ffi-evidence-v1"`

## Invariants

1. **Silver-Only Input**: FFI evidence features are derived strictly from Silver FFI summary Parquet files and optional Silver cutouts. Raw Bronze FITS files are NEVER accessed.
2. **Conservative Scope**: Full 2048x2048 detector pixel arrays are not required. Features provide bounded image summary metrics and optional local cutout contrast evidence.
3. **Missing Values**: Features derived from optional cutouts MUST use `null`/`NaN` representation when cutouts are absent (`cutout_evidence_available = false`).

## Feature Record Schema

### 1. Identity & Provenance Fields

| Field | Type | Nullable | Description |
| :--- | :--- | :---: | :--- |
| `lineage_id` | string | | SHA256 hex digest of upstream FFI Lineage record. |
| `source_product_id` | string | | Original NASA/MAST source product identifier. |
| `sector` | integer | | TESS observing sector number. |
| `camera` | integer | | TESS camera identifier. |
| `ccd` | integer | | TESS CCD identifier. |
| `processor_version` | string | | Preprocessor version (e.g. `"ffi-preprocess-v1"`). |
| `silver_schema_version` | string | | Silver schema version (e.g. `"silver-ffi-v1"`). |
| `silver_sha256` | string | | SHA-256 hex digest of Silver FFI Parquet artifact. |
| `ffi_feature_version` | string | | FFI feature schema version. Currently `"ffi-evidence-v1"`. |
| `ffi_feature_fingerprint` | string | | SHA-256 hex digest of `(ffi_feature_version + canonical_config)`. |
| `ffi_feature_status` | string | | Status: `"SUCCESS"`, `"NO_CUTOUTS"`, `"INVALID_INPUT"`. |

### 2. Full Detector Image Summary Fields

| Field | Type | Nullable | Description |
| :--- | :--- | :---: | :--- |
| `ffi_width` | integer | | Detector image width in pixels (e.g. 2048). |
| `ffi_height` | integer | | Detector image height in pixels (e.g. 2048). |
| `ffi_finite_pixel_count` | integer | | Total count of valid non-NaN finite pixels. |
| `ffi_finite_pixel_fraction` | float64 | | Ratio of finite pixels across full detector image. |
| `ffi_median` | float64 | | Finite pixel median flux. |
| `ffi_mean` | float64 | | Finite pixel mean flux. |
| `ffi_stddev` | float64 | | Finite pixel standard deviation. |
| `ffi_min` | float64 | | Minimum finite pixel flux. |
| `ffi_max` | float64 | | Maximum finite pixel flux. |
| `ffi_dynamic_range` | float64 | | Full image dynamic range (`ffi_max - ffi_min`). |

### 3. Optional Cutout Contrast Evidence Fields

| Field | Type | Nullable | Description |
| :--- | :--- | :---: | :--- |
| `cutout_evidence_available` | boolean | | `true` if bounded cutouts were processed. |
| `cutout_count` | integer | | Total count of cutouts processed. |
| `cutout_deviation_sum` | float64 | ✓ | Sum of absolute deviations from cutout median. |
| `cutout_peak_deviation_fraction` | float64 | ✓ | Peak concentration: `max(deviation) / sum(deviation)`. |
| `cutout_deviation_effective_pixels` | float64 | ✓ | Effective pixel count of local deviation map. |
| `border_median` | float64 | ✓ | Background proxy: median of 1-pixel outer border. |
| `border_mad` | float64 | ✓ | Background proxy scatter: MAD of 1-pixel outer border. |
| `center_deviation_fraction` | float64 | ✓ | Ratio of central 3x3 region deviation to total cutout deviation. |

## Example FFI Feature Record

```json
{
  "lineage_id": "c7f2c8d1928014819031",
  "source_product_id": "tess-ffi-s0001-c1-ccd1",
  "sector": 1,
  "camera": 1,
  "ccd": 1,
  "processor_version": "ffi-preprocess-v1",
  "silver_schema_version": "silver-ffi-v1",
  "silver_sha256": "f9ca4238a0b923820dcc509a6f75849e",
  "ffi_feature_version": "ffi-evidence-v1",
  "ffi_feature_fingerprint": "9b0c920148...49481031",
  "ffi_feature_status": "SUCCESS",
  "ffi_width": 2048,
  "ffi_height": 2048,
  "ffi_finite_pixel_count": 4194304,
  "ffi_finite_pixel_fraction": 1.0,
  "ffi_median": 1245.5,
  "ffi_mean": 1250.2,
  "ffi_stddev": 145.8,
  "ffi_min": 100.0,
  "ffi_max": 65535.0,
  "ffi_dynamic_range": 65435.0,
  "cutout_evidence_available": false,
  "cutout_count": 0
}
```
