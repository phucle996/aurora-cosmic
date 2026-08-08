# CATALOGS.md — AURORA Catalog Snapshot Architecture & Process

> **AURORA Cosmic Data Platform**  
> **Stage 5 — Gold Dataset & Scientific Analytics**

---

## 1. Catalog Philosophy & External Invariant

In the AURORA platform, external astronomical catalogs (TIC, TOI, TCE) are treated as **mutable external inputs**. Unlike Silver Parquet time-series, catalog contents evolve upstream over time as NASA processes new sectors and updates exoplanet dispositions.

### Core Invariants

1. **No Live Queries During Scientific Reproduction**: Scientific reproducibility MUST NOT query live HTTP endpoints. Recreating a historical Gold dataset or training run MUST use the exact frozen catalog snapshot referenced by `snapshot_id`.
2. **Canonical Normalization**: Raw downloads are converted to normalized Parquet tables (`catalogs/tess/<type>/snapshot=<snapshot-id>/`) with canonical sorting and strict type coercion.
3. **Silver-Only Execution**: Catalog ingestion and enrichment operate 100% cleanly when raw Bronze FITS files are `RAW_DELETED`.

---

## 2. MinIO Storage Layout

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

---

## 3. Snapshot Identity Derivation Algorithm

Identity is derived strictly from a canonical SHA-256 digest of normalized catalog content, catalog type, and normalization version.

### Deterministic Inputs
1. `catalog_type`: `"TIC"`, `"TOI"`, or `"TCE"`
2. `normalization_version`: e.g. `"tic-normalize-v1"`
3. `data_sha256`: SHA-256 hex digest of `data.parquet`

Wall-clock timestamps (`retrieved_at`), process PIDs, or worker hostnames DO NOT alter `snapshot_id` for identical normalized catalog content.

---

## 4. Offline Fixture Mode

For automated testing and CI pipelines, catalog acquisition supports deterministic local fixtures without relying on live NASA web services:

```text
apps/python-ml-worker/tests/fixtures/catalogs/
├── tic-small.csv
├── toi-small.csv
└── tce-small.csv
```
