# catalog-toi-v1 — AURORA Normalized TESS Objects of Interest (TOI) Catalog Contract

## Purpose

Durable schema contract for normalized TESS Objects of Interest (TOI) candidate catalog snapshots.

## Schema Version

`normalization_version: "toi-normalize-v1"`

## Primary Key

`toi_id` (String identifier preserving external formatting, e.g. `"123.01"`).

## Column Schema

| Column Name | Arrow Type | Nullable | Unit | Description |
| :--- | :--- | :---: | :---: | :--- |
| `toi_id` | `Utf8` | No | | TESS Object of Interest identifier (e.g. `"123.01"`). |
| `tic_id` | `Int64` | No | | Associated TESS Input Catalog ID. |
| `catalog_period` | `Float64` | Yes | days | Catalog orbital period in days. |
| `catalog_epoch` | `Float64` | Yes | days | Catalog epoch time (BJD or mission time). |
| `catalog_duration` | `Float64` | Yes | days | Catalog transit duration in days. |
| `catalog_depth` | `Float64` | Yes | norm_flux | Catalog transit depth magnitude. |
| `toi_disposition_raw` | `Utf8` | No | | Original raw disposition string from upstream catalog. |
| `toi_disposition_norm` | `Utf8` | No | | Normalized category: `"KNOWN_PLANET"`, `"CANDIDATE"`, `"FALSE_POSITIVE"`, `"AMBIGUOUS"`, `"OTHER"`, `"UNKNOWN"`. |

## Invariants & Rules

1. **Format Preservation**: `toi_id` MUST retain string formatting (e.g. `"123.01"`), preventing floating-point precision loss.
2. **Multi-Planet Support**: Multiple TOI rows can share the same `tic_id`. Matching algorithms MUST use period and epoch alignment in addition to `tic_id`.
