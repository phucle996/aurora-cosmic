# catalog-snapshot-v1 — AURORA Immutable Catalog Snapshot Contract

## Purpose

Durable data contract specifying manifest and layout requirements for frozen, versioned astronomical catalog snapshots (TIC, TOI, TCE).

## Invariants

1. **Immutability**: Once written to MinIO (`catalogs/tess/<type>/snapshot=<snapshot-id>/`), catalog snapshot artifacts MUST NOT be overwritten or mutated.
2. **Deterministic Identity**: `snapshot_id` and `snapshot_fingerprint` are derived strictly from a canonical SHA-256 digest of normalized catalog content, catalog type, and normalization version. Wall-clock retrieval timestamps DO NOT alter snapshot identity for identical content.
3. **Canonical Sorting**: Catalog data is sorted deterministically by primary keys before hashing to guarantee row-order independence.

## Storage Layout

```text
catalogs/
└── tess/
    ├── tic/
    │   └── snapshot=<snapshot-id>/
    │       ├── manifest.json
    │       └── data.parquet
    ├── toi/
    │   └── snapshot=<snapshot-id>/
    │       ├── manifest.json
    │       └── data.parquet
    └── tce/
        └── snapshot=<snapshot-id>/
            ├── manifest.json
            └── data.parquet
```

## Manifest JSON Schema (`manifest.json`)

```json
{
  "schema_version": "catalog-snapshot-v1",
  "catalog_type": "TIC | TOI | TCE",
  "snapshot_id": "tic-v1-<sha256-prefix>",
  "snapshot_fingerprint": "<sha256-hex-digest>",
  "normalization_version": "tic-normalize-v1",
  "provider": "NASA Exoplanet Archive | MAST",
  "source_uri": "https://exoplanetarchive.ipac.caltech.edu/...",
  "source_query": "SELECT * FROM ...",
  "retrieved_at": "2026-08-08T11:00:00Z",
  "row_count": 1000,
  "data_object_key": "catalogs/tess/tic/snapshot=tic-v1-4f72be920841/data.parquet",
  "data_sha256": "<sha256-hex-digest-of-data.parquet>"
}
```
