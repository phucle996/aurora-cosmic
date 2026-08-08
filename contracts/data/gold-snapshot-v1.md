# gold-snapshot-v1 — AURORA Gold Snapshot Manifest Data Contract

## Purpose

Durable, immutable dataset-level manifest contract defining a Gold snapshot identity, its verified Silver Parquet inputs, feature versions, schema versions, and versioned catalog/label snapshot references.

## Storage Location

```text
MinIO: gold/snapshots/<snapshot-id>/manifest.json
```

Where `<snapshot-id>` is formatted as `gold-v1-<sha256-prefix>` (e.g. `gold-v1-4f72be920841`).

## Schema Version

`schema_version: 1`

## Invariants

1. **Silver-Only Input**: Gold snapshots depend strictly on durable Silver Parquet artifacts and permanent Lineage records. Raw Bronze FITS files are NEVER required.
2. **Immutability**: Once written to `gold/snapshots/<snapshot-id>/manifest.json`, a Gold snapshot manifest is immutable and MUST NEVER be altered in place.
3. **Deterministic Identity**: Given identical Silver inputs, Gold schema versions, feature versions, catalog snapshots, and label snapshots, the resulting `snapshot_id` and `snapshot_fingerprint` MUST be identical.
4. **Time & Environment Independence**: Wall-clock timestamps (`created_at`), hostnames, container IDs, Python `hash()`, and random UUIDs MUST NOT participate in `snapshot_id` derivation.
5. **Bronze Raw Deletion Safety**: A valid Silver artifact with committed lineage remains a valid Gold snapshot input even when its associated Bronze object is `RAW_DELETED`.

## Top-Level Fields

| Field | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `schema_version` | integer | ✓ | Manifest schema version. Currently `1`. |
| `snapshot_id` | string | ✓ | Human-safe deterministic snapshot ID (`gold-v1-<sha256-prefix>`). |
| `snapshot_fingerprint` | string | ✓ | Full 64-character SHA-256 hex digest of the canonical snapshot definition. |
| `snapshot_type` | string | ✓ | Dataset family type: `"CANDIDATE"` or `"ANOMALY"`. |
| `gold_schema_version` | string | ✓ | Gold dataset schema version (e.g. `"gold-candidate-v1"`). |
| `feature_versions` | map[string]string | ✓ | Map of component feature versions (e.g. `{"LIGHT_CURVE": "lc-features-v1"}`). |
| `input_count` | integer | ✓ | Total count of Silver input references (`len(inputs)`). |
| `inputs` | array[object] | ✓ | List of verified Silver input references, sorted canonically. |
| `catalog_snapshots` | map[string]string | ✓ | Versioned catalog references (e.g. `{"TIC": "v8.2"}` or `{}`). |
| `label_snapshots` | map[string]string | ✓ | Versioned label references (e.g. `{"TOI": "2026-08-08"}` or `{}`). |
| `created_at` | string | ✓ | ISO-8601 timestamp of plan generation (diagnostics only). |
| `producer` | string | ✓ | Component producer string (`"python-ml-worker"`). |

## `inputs` Array Item (`SilverInputRef`)

| Field | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `lineage_id` | string | ✓ | SHA256 hex digest of the upstream Lineage record. |
| `source_product_id` | string | ✓ | Original NASA/MAST source product ID. |
| `product_kind` | string | ✓ | `LIGHT_CURVE`, `TARGET_PIXEL`, or `FFI`. |
| `silver_bucket` | string | ✓ | MinIO bucket containing Silver Parquet artifact. |
| `silver_object_key` | string | ✓ | Object key of Silver Parquet artifact. |
| `silver_sha256` | string | ✓ | SHA-256 hex digest of Silver Parquet artifact bytes. |
| `silver_schema_version` | string | ✓ | Silver schema version (e.g. `"silver-lightcurve-v1"`). |
| `processor_version` | string | ✓ | Upstream preprocessor version (e.g. `"lc-preprocess-v1"`). |
| `sample_id` | string | – | Optional TIC/sector pairing sample identifier. |

## Canonical Sorting & Fingerprint Algorithm

1. **Sort Silver Inputs**: Sort `inputs` deterministically by `(product_kind, source_product_id, processor_version, silver_object_key)`.
2. **Canonical JSON Serialization**: Serialize a JSON object containing:
   - `identity_version`: `"gold-snapshot-id-v1"`
   - `snapshot_type`
   - `gold_schema_version`
   - `feature_versions` (sorted keys)
   - `catalog_snapshots` (sorted keys)
   - `label_snapshots` (sorted keys)
   - `inputs` (sorted array of canonical SilverInputRef fields: `lineage_id`, `source_product_id`, `product_kind`, `silver_object_key`, `silver_sha256`, `silver_schema_version`, `processor_version`, `sample_id`)
3. **Compute Digest**:
   - `snapshot_fingerprint = SHA256_HEX(canonical_json)` (64 chars)
   - `snapshot_id = "gold-v1-" + snapshot_fingerprint[:12]`

## Example Manifest Record

```json
{
  "schema_version": 1,
  "snapshot_id": "gold-v1-4f72be920841",
  "snapshot_fingerprint": "4f72be92084128f993d0c4118a821e25e9821804b73251218091850182901248",
  "snapshot_type": "CANDIDATE",
  "gold_schema_version": "gold-candidate-v1",
  "feature_versions": {
    "LIGHT_CURVE": "lc-features-v1"
  },
  "input_count": 1,
  "inputs": [
    {
      "lineage_id": "a3f2c8d1928014819028",
      "source_product_id": "tess-lc-12345678-s0001-0120",
      "product_kind": "LIGHT_CURVE",
      "silver_bucket": "aurora-silver",
      "silver_object_key": "silver/tess/lightcurve/processor=lc-preprocess-v1/sector=0001/tic=12345678/tess-lc-12345678-s0001-0120.parquet",
      "silver_sha256": "c4ca4238a0b923820dcc509a6f75849b",
      "silver_schema_version": "silver-lightcurve-v1",
      "processor_version": "lc-preprocess-v1",
      "sample_id": "tic:12345678:s:1"
    }
  ],
  "catalog_snapshots": {},
  "label_snapshots": {},
  "created_at": "2026-08-08T11:00:00Z",
  "producer": "python-ml-worker"
}
```
