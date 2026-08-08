# catalog-tce-v1 — AURORA Normalized Threshold Crossing Events (TCE) Catalog Contract

## Purpose

Durable schema contract for normalized Threshold Crossing Events (TCE) pipeline detection catalog snapshots.

## Schema Version

`normalization_version: "tce-normalize-v1"`

## Primary Key

`tce_id` (String identifier, e.g. `"tce-12345678-s0001-01"`).

## Column Schema

| Column Name | Arrow Type | Nullable | Unit | Description |
| :--- | :--- | :---: | :---: | :--- |
| `tce_id` | `Utf8` | No | | Threshold Crossing Event identifier. |
| `tic_id` | `Int64` | No | | Associated TESS Input Catalog ID. |
| `sector` | `Int32` | Yes | | Sector number associated with detection. |
| `catalog_period` | `Float64` | Yes | days | Pipeline detected period in days. |
| `catalog_epoch` | `Float64` | Yes | days | Pipeline detected epoch time. |
| `catalog_duration` | `Float64` | Yes | days | Pipeline detected duration in days. |
| `detection_statistic` | `Float64` | Yes | dimensionless | Pipeline signal-to-noise or detection statistic score. |
| `tce_disposition_raw` | `Utf8` | Yes | | Original raw disposition string from pipeline. |

## Invariants & Rules

1. **Pipeline Detections**: TCE entries represent automated pipeline detections, NOT confirmed planets.
2. **Sector Scope**: Candidate matching against TCE entries MUST verify sector compatibility when sector metadata is present.
