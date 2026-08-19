# planet-physics-v1 — deterministic planet physics contract

## Purpose

Defines the reproducible physical read model for one transit signal. This is a
screening product, not a planet confirmation and not a claim about life.

## Stable identity

`planet_candidate_id` is `pc_` plus the first 12 bytes of SHA-256 over:

```text
tic:<tic_id>|sector:<sector>|source:<source_product_id>|period:<bls_period>|epoch:<bls_transit_time>|duration:<bls_duration>|v1
```

The same signal keeps its identity across model runs. A materially different
ephemeris receives a different identity.

## Fields

| Field | Unit | Nullable | Source |
| --- | --- | :---: | --- |
| `planet_candidate_id` | — | No | deterministic identity |
| `physics_model_version` | — | No | `planet-physics-solar-baseline-v1` |
| `orbital_period_days` | day | Yes | BLS observation |
| `transit_depth_fraction` | relative flux | Yes | BLS observation |
| `planet_radius_earth` | R_earth | Yes | derived from depth and stellar radius |
| `semi_major_axis_au` | AU | Yes | Kepler's third law |
| `stellar_luminosity_solar` | L_sun | Yes | radius and effective temperature |
| `insolation_earth` | S_earth | Yes | luminosity divided by orbital distance squared |
| `equilibrium_temperature_k` | K | Yes | albedo 0.30, full heat redistribution |
| `hz_classification` | — | No | `conservative`, `optimistic`, `outside`, `unknown` |
| `input_completeness` | 0..1 | No | available required inputs / 5 |
| `warnings` | array | No | missing inputs and model-domain warnings |

## Equations and assumptions

- `L_star/L_sun = R_star^2 * (T_eff / 5772 K)^4`
- `a_AU = cbrt(M_star * (P_days / 365.25)^2)`
- `R_p/R_earth = sqrt(transit_depth) * R_star/R_sun * 109.076`
- `S/S_earth = (L_star/L_sun) / a_AU^2`
- equilibrium temperature assumes Bond albedo `0.30` and full redistribution

Version 1 uses transparent solar-baseline flux boundaries: conservative
`0.36..1.06 S_earth`, optimistic `0.32..1.78 S_earth`. A warning is emitted
outside `4000..7000 K`; a future version should replace these fixed boundaries
with a temperature-dependent climate prescription.

## Missing data rule

Missing values remain null. The producer must not silently insert Earth, Solar,
or population-average values.
