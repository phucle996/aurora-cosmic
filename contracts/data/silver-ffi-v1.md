# Silver Data Contract — Full Frame Image V1

Schema Version: `silver-ffi-v1`
Processor Version: `ffi-preprocess-v1`
Storage Format: `Apache Parquet (ZSTD compression)`
Default MinIO Path: `silver/tess/ffi/processor={processor_version}/sector={sector:04}/camera={camera}/ccd={ccd}/{source_product_id}.parquet`

---

## Columns

| Column Name | Arrow Type | Nullable | Semantic Description |
|---|---|---|---|
| `width` | `Int32` | No | Detector image width in pixels |
| `height` | `Int32` | No | Detector image height in pixels |
| `finite_pixel_count` | `Int64` | No | Total count of valid non-NaN finite pixels |
| `finite_pixel_fraction` | `Float32` | No | Ratio of finite pixels to total pixels |
| `median` | `Float32` | No | Finite pixel median flux |
| `mean` | `Float32` | No | Finite pixel mean flux |
| `stddev` | `Float32` | No | Finite pixel standard deviation |
| `min` | `Float32` | No | Minimum finite pixel flux |
| `max` | `Float32` | No | Maximum finite pixel flux |

---

## File / S3 Metadata Headers

- `schema-version`: `silver-ffi-v1`
- `processor-version`: `ffi-preprocess-v1`
- `source-product-id`: MAST source identifier
- `bronze-object-key`: MinIO Bronze source key
- `bronze-sha256`: SHA-256 hash of raw Bronze FITS file
- `silver-sha256`: SHA-256 hash of Silver Parquet file
- `product-kind`: `FFI`
