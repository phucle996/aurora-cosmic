# gold-anomaly-v1 — AURORA Materialized Anomaly Evidence Gold Schema Contract

## Purpose

Durable schema contract for Anomaly Evidence Gold Parquet datasets materialized under `gold/snapshots/<snapshot-id>/data/anomaly/`.

## Schema Version

`gold_schema_version: "gold-anomaly-v1"`

## Storage Partition Layout

```text
gold/
└── snapshots/
    └── <snapshot-id>/
        ├── manifest.json
        └── data/
            └── anomaly/
                ├── lightcurve/
                │   └── sector=0042/
                │       └── part-00000.parquet
                ├── tpf/
                │   └── sector=0042/
                │       └── part-00000.parquet
                └── ffi/
                    └── sector=0042/
                        └── part-00000.parquet
```

## Component Logical Tables

### 1. Light Curve Anomaly Dataset (`lightcurve/`)
- Materializes `gold-lightcurve-features-v1` records.
- One row per eligible Silver Light Curve product.

### 2. Target Pixel File Anomaly Dataset (`tpf/`)
- Materializes `gold-tpf-vetting-v1` spatial evidence records.
- One row per eligible Silver Target Pixel product.

### 3. Full Frame Image Anomaly Dataset (`ffi/`)
- Materializes `gold-ffi-evidence-v1` detector context & cutout summary records.
- One row per eligible Silver FFI product.
