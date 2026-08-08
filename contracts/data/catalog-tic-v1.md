# catalog-tic-v1 — AURORA Normalized TESS Input Catalog (TIC) Contract

## Purpose

Durable schema contract for normalized TESS Input Catalog (TIC) target and stellar metadata snapshots.

## Schema Version

`normalization_version: "tic-normalize-v1"`

## Primary Key

`tic_id` (Unique integer identifier).

## Column Schema

| Column Name | Arrow Type | Nullable | Unit | Description |
| :--- | :--- | :---: | :---: | :--- |
| `tic_id` | `Int64` | No | | TESS Input Catalog ID. Unique primary key. |
| `ra_deg` | `Float64` | Yes | deg | Right Ascension (J2000). |
| `dec_deg` | `Float64` | Yes | deg | Declination (J2000). |
| `tmag` | `Float64` | Yes | mag | TESS magnitude. |
| `teff` | `Float64` | Yes | K | Effective stellar temperature. |
| `stellar_radius` | `Float64` | Yes | R_sun | Stellar radius in solar radii. |
| `stellar_mass` | `Float64` | Yes | M_sun | Stellar mass in solar masses. |
| `logg` | `Float64` | Yes | cgs | Surface gravity `log10(g)`. |

## Invariants & Rules

1. **Uniqueness**: `tic_id` MUST be unique across all rows in a normalized snapshot. Duplicate `tic_id` entries MUST be rejected during normalization with `CATALOG_DUPLICATE_KEY`.
2. **Nullable Semantics**: Missing stellar properties MUST be represented as `null`/`NaN`, NEVER as zero (`0`).
