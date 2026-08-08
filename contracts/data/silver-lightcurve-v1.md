# Silver Data Contract — Light Curve V1

Schema Version: `silver-lightcurve-v1`
Processor Version: `lc-preprocess-v1`
Storage Format: `Apache Parquet (ZSTD compression)`
Default MinIO Path: `silver/tess/lightcurve/processor={processor_version}/sector={sector:04}/tic={tic_id}/{source_product_id}.parquet`

---

## Columns

| Column Name | Arrow Type | Nullable | Semantic Description |
|---|---|---|---|
| `time` | `Float64` | No | BJD / TESS Barycentric Julian Date timestamp |
| `flux` | `Float32` | No | Median-normalized flux (`(flux / median) - 1.0`, baseline = 0.0) |
| `flux_err` | `Float32` | Yes | Median-normalized flux uncertainty (`flux_err / median`) |
| `quality` | `Int32` | No | TESS cadence quality flag (Strict mode: `quality == 0`) |

---

## File / S3 Metadata Headers

- `schema-version`: `silver-lightcurve-v1`
- `processor-version`: `lc-preprocess-v1`
- `source-product-id`: MAST source identifier
- `bronze-object-key`: MinIO Bronze source key
- `bronze-sha256`: SHA-256 hash of raw Bronze FITS file
- `silver-sha256`: SHA-256 hash of Silver Parquet file
- `product-kind`: `LIGHT_CURVE`
- `tic-id`: TESS Input Catalog ID
- `sector`: TESS Sector number
