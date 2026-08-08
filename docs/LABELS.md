# LABELS.md — AURORA Candidate Label Derivation & Leakage Prevention Rules

> **AURORA Cosmic Data Platform**  
> **Stage 5 — Gold Dataset & Scientific Analytics**

---

## 1. Candidate Label Policy (`candidate-label-policy-v1`)

Candidate training labels are derived conservatively from versioned TOI catalog snapshots (`catalogs/tess/toi/`) and candidate ephemeris matching (`toi-match-v1`).

### Mapping Table

| Catalog Disposition | TOI Match Status | Derived Training Label |
| :--- | :--- | :--- |
| `KNOWN_PLANET` / `CONFIRMED` | `EPHEMERIS_MATCH` / `PERIOD_ONLY` | `POSITIVE` |
| `FALSE_POSITIVE` | `EPHEMERIS_MATCH` / `PERIOD_ONLY` | `NEGATIVE` |
| `CANDIDATE` / `PENDING` | Any | `UNRESOLVED` |
| Any | `NO_MATCH` / `AMBIGUOUS` | `UNRESOLVED` |

---

## 2. Strict Supervised Label Invariants

1. **No Automatic Positives**: TOI candidates (`CANDIDATE` status) are NOT confirmed planets. They map to `UNRESOLVED`.
2. **No Automatic Negatives**: Unmatched targets (`NO_MATCH`) are NOT proven false positives. Absence from a catalog does NOT prove non-existence. They map to `UNRESOLVED`.
3. **Supervised Split Filtering**: Supervised ML models in Stage 6 MUST train strictly on resolved labels (`POSITIVE` and `NEGATIVE`). `UNRESOLVED` records are excluded from binary cross-entropy loss unless using semi-supervised anomaly detection.

---

## 3. Strict Signal Feature Independence (No Label Leakage)

> ⚠️ **Strict Leakage Prevention Rule:**  
> **Catalog dispositions and training labels MUST NOT contaminate signal feature extraction (`lc-features-v1`, `tpf-vetting-v1`, `ffi-evidence-v1`).**

- `bls_period`, `bls_depth`, `flux_std`, and `transit_deficit_centroid` are derived strictly from Silver signal arrays.
- Changing a TOI catalog disposition creates a new `label_snapshot_id` but leaves signal feature outputs 100% identical.
- Supervision metadata (`training_label`, `toi_disposition`, `matched_toi_id`) is strictly tagged and MUST NOT be included in model input feature allowlists during supervised training.
