# candidate-scientific-review-v1 — Scientific Adjudication Contract

## Purpose

Stores a human scientific decision about one immutable candidate prediction. This mutable review overlay is independent from both Candidate Gold evidence and the supervised training-label cohort.

## Primary Key

`(snapshot_id, prediction_id)` with last-write-wins semantics by `updated_at`.

## Column Schema

| Column | Type | Meaning |
| :--- | :--- | :--- |
| `snapshot_id` | `String` | Immutable Gold snapshot containing the evidence. |
| `prediction_id` | `String` | Candidate inference result being reviewed. |
| `source_product_id` | `String` | Source LC product used by the prediction. |
| `tic_id` | `Int64` | TESS Input Catalog target ID. |
| `sector` | `Int32` | TESS observing sector. |
| `scientific_decision` | `LowCardinality(String)` | `CONFIRMED`, `REJECTED`, or `FOLLOW_UP`. |
| `review_status` | `LowCardinality(String)` | Workflow status; currently `REVIEWED`. |
| `reviewer` | `String` | Actor that made the decision; currently `HUMAN_OPERATOR`. |
| `review_note` | `String` | Optional evidence-based rationale, up to 2,000 characters. |
| `updated_at` | `DateTime64(3, UTC)` | Durable decision timestamp. |

## Invariants

1. Candidate Review never updates `candidate_training_cohort_v1`.
2. Labeling Studio remains the only UI that writes `POSITIVE`, `NEGATIVE`, or `UNRESOLVED` training labels.
3. Review writes never mutate Candidate Gold artifacts or inference results.
4. A later decision becomes the visible decision for the same snapshot and prediction; physical replacement follows ClickHouse merge-tree semantics.
