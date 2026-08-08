# Silver Data Contract — Target Pixel File V1

Schema Version: `silver-target-pixel-v1`
Processor Version: `tpf-preprocess-v1`
Storage Format: `Apache Parquet (ZSTD compression)`
Default MinIO Path: `silver/tess/target-pixel/processor={processor_version}/sector={sector:04}/tic={tic_id}/{source_product_id}.parquet`

---

## Columns

| Column Name | Arrow Type | Nullable | Semantic Description |
|---|---|---|---|
| `time` | `Float64` | No | Cadence timestamp (BJD) |
| `quality` | `Int32` | No | TESS quality bitmask flag |
| `flux` | `List<Float32>` | No | Flattened row-major pixel flux array (`rows * cols` elements) |
| `rows` | `Int32` | No | Image cutout row dimension |
| `cols` | `Int32` | No | Image cutout column dimension |

---

## File / S3 Metadata Headers

- `schema-version`: `silver-target-pixel-v1`
- `processor-version`: `tpf-preprocess-v1`
- `source-product-id`: MAST source identifier
- `bronze-object-key`: MinIO Bronze source key
- `bronze-sha256`: SHA-256 hash of raw Bronze FITS file
- `silver-sha256`: SHA-256 hash of Silver Parquet file
- `product-kind`: `TARGET_PIXEL`
