# habitability-assessment-v1 — explainable prioritization contract

## Semantics

The assessment helps prioritize follow-up. It does not estimate the probability
that life exists. Physics and machine-learning results are separate fields.

| Field | Type | Meaning |
| --- | --- | --- |
| `assessment_version` | String | `habitability-physics-v1` |
| `status` | Enum | `evaluated` or `insufficient_data` |
| `physics_score` | Nullable Float64 | explainable 0–100 screening score |
| `confidence` | Float64 | input completeness, not model probability |
| `tier` | Enum | `high_priority`, `promising`, `low_priority`, `unlikely`, `not_assessed` |
| `components` | Array | component score, maximum, availability, reason |
| `ml_score` | Nullable Float64 | learned score; null until evaluated model output exists |
| `ml_status` | Enum | initially `not_evaluated` |
| `disclaimer` | String | required scientific-use warning |

## Physics score v1

- Habitable-zone position: 40 points
- Rocky-size likelihood: 20 points
- Equilibrium-temperature screen: 15 points
- Stellar-environment screen: 15 points
- Input completeness: 10 points

The score is returned only when both habitable-zone position and planet-radius
screening can be evaluated. Missing components remain visible in the response.

## ML release gate

`ml_score` must remain null until a registered model has a frozen dataset,
leakage-safe splits by target/system, documented metrics and calibration, an
out-of-distribution policy, and a runtime validation record. A transit-vetting
score must never be relabeled as a habitability score.
