# lineage-v1 — AURORA Preprocessing Lineage Record

## Purpose

Permanent durable provenance record proving that a Bronze source FITS product
was successfully transformed into a verified Silver Parquet artifact.

## Storage

```
MinIO: lineage/v1/tess/{product_kind}/{lineage_id}.json
```

Where `product_kind` is one of: `lightcurve`, `target-pixel`, `ffi`.

## Schema Version

`schema_version: 1`

## Top-Level Fields

| Field                          | Type    | Required | Description                                                             |
|-------------------------------|---------|----------|-------------------------------------------------------------------------|
| `schema_version`              | integer | ✓        | Schema version. Currently `1`.                                          |
| `lineage_id`                  | string  | ✓        | `SHA256(source_product_id + ":" + processor_version)` — hex, 64 chars |
| `status`                      | string  | ✓        | Always `"LINEAGE_COMMITTED"`                                            |
| `source`                      | object  | ✓        | Source retrieval provenance (see below)                                 |
| `bronze`                      | object  | ✓        | Bronze object identity                                                  |
| `processing`                  | object  | ✓        | Processing provenance                                                   |
| `silver`                      | object  | ✓        | Silver artifact identity                                                |
| `eviction`                    | object  | ✓        | Bronze eviction eligibility evaluation                                  |
| `preprocessing_checkpoint_id` | string  | –        | Back-reference to checkpoint for diagnostics                            |
| `committed_at`                | string  | ✓        | RFC-3339 ISO-8601 timestamp of first commit                             |

## `source` Object

| Field              | Type   | Required | Description                                          |
|-------------------|--------|----------|------------------------------------------------------|
| `provider`        | string | ✓        | Always `"MAST"`                                      |
| `mission`         | string | ✓        | Always `"TESS"`                                      |
| `source_product_id` | string | ✓      | Original MAST product identifier                     |
| `source_uri`      | string | –        | MAST retrieval URI — required for eviction eligibility |
| `source_version`  | string | –        | MAST data release version if available               |

## `bronze` Object

| Field          | Type    | Required | Description                            |
|---------------|---------|----------|----------------------------------------|
| `bucket`      | string  | ✓        | MinIO Bronze bucket                    |
| `object_key`  | string  | ✓        | Deterministic MinIO object key         |
| `size_bytes`  | integer | ✓        | Verified object size                   |
| `sha256`      | string  | ✓        | Verified SHA-256 hex digest            |
| `product_kind`| string  | ✓        | `LIGHT_CURVE`, `TARGET_PIXEL`, or `FFI` |
| `sector`      | integer | ✓        | TESS observing sector                  |
| `tic_id`      | integer | –        | TESS Input Catalog ID                  |
| `camera`      | integer | –        | TESS camera number (FFI only)          |
| `ccd`         | integer | –        | TESS CCD number (FFI only)             |

## `processing` Object

| Field                    | Type   | Required | Description                                                          |
|-------------------------|--------|----------|----------------------------------------------------------------------|
| `service`               | string | ✓        | Always `"rust-preprocessor"`                                         |
| `processor_version`     | string | ✓        | Algorithm version (e.g. `"lc-preprocess-v1"`)                        |
| `product_kind`          | string | ✓        | AURORA product kind                                                   |
| `processing_parameters` | object | ✓        | Scientific config snapshot (output-affecting settings only)           |
| `processing_fingerprint`| string | ✓        | `SHA256(processor_version + ":" + processing_parameters)` — hex      |

## `silver` Object

| Field              | Type    | Required | Description                             |
|-------------------|---------|----------|-----------------------------------------|
| `bucket`          | string  | ✓        | MinIO Silver bucket                     |
| `object_key`      | string  | ✓        | Deterministic Silver Parquet object key |
| `size_bytes`      | integer | ✓        | Parquet file size in bytes              |
| `sha256`          | string  | ✓        | SHA-256 hex digest of Parquet file      |
| `schema_version`  | string  | ✓        | Parquet schema version (e.g. `"silver-lightcurve-v1"`) |
| `processor_version` | string | ✓      | Algorithm version                       |

## `eviction` Object

| Field            | Type    | Required | Description                                           |
|-----------------|---------|----------|-------------------------------------------------------|
| `policy_version`| string  | ✓        | Always `"bronze-eviction-v1"` in Phase 4.4            |
| `eligible`      | boolean | ✓        | Whether Bronze may be deleted                         |
| `reason`        | string  | ✓        | Machine-readable reason code                          |

### Reason Codes

| Code                       | Eligible | Description                                   |
|---------------------------|----------|-----------------------------------------------|
| `SUCCESSFUL_SILVER_DURABLE`| true     | All conditions met — safe to evict            |
| `SOURCE_URI_MISSING`       | false    | `source_uri` not present in Bronze metadata   |
| `CHECKPOINT_NOT_COMPLETED` | false    | Checkpoint was not COMPLETED at lineage commit|
| `PROCESSING_REJECTED`      | false    | Processing failed — lineage not clean         |
| `SILVER_MISSING`           | false    | Silver SHA256 was empty                       |

## Example Record

```json
{
  "schema_version": 1,
  "lineage_id": "a3f2...c8d1",
  "status": "LINEAGE_COMMITTED",
  "source": {
    "provider": "MAST",
    "mission": "TESS",
    "source_product_id": "tess-lc-12345678-s0001-0120",
    "source_uri": "https://mast.stsci.edu/api/v0.1/Download/file?uri=...",
    "source_version": null
  },
  "bronze": {
    "bucket": "aurora-bronze",
    "object_key": "tess/lightcurve/sector=0001/tess-lc-12345678-s0001-0120.fits",
    "size_bytes": 2097152,
    "sha256": "d41d8cd98f00b204e9800998ecf8427e",
    "product_kind": "LIGHT_CURVE",
    "sector": 1,
    "tic_id": 12345678,
    "camera": null,
    "ccd": null
  },
  "processing": {
    "service": "rust-preprocessor",
    "processor_version": "lc-preprocess-v1",
    "product_kind": "LIGHT_CURVE",
    "processing_parameters": {
      "min_points": 100,
      "quality_mode": "strict",
      "allow_sap_fallback": false,
      "sigma_clip": null
    },
    "processing_fingerprint": "b94d27b9934d3e08..."
  },
  "silver": {
    "bucket": "aurora-silver",
    "object_key": "silver/tess/lightcurve/processor=lc-preprocess-v1/sector=0001/tic=12345678/tess-lc-12345678-s0001-0120.parquet",
    "size_bytes": 131072,
    "sha256": "c4ca4238a0b923820dcc509a6f75849b",
    "schema_version": "silver-lightcurve-v1",
    "processor_version": "lc-preprocess-v1"
  },
  "eviction": {
    "policy_version": "bronze-eviction-v1",
    "eligible": true,
    "reason": "SUCCESSFUL_SILVER_DURABLE"
  },
  "preprocessing_checkpoint_id": "a3f2...c8d1",
  "committed_at": "2026-08-07T12:00:00Z"
}
```
