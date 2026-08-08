# AURORA Model Registry (Phase 6.5)

This document describes the immutable model package layout, champion / challenger promotion criteria, and rollback operations for AURORA models.

---

## 1. Registry Storage Layout

Model packages are immutable and organized by task:
```text
models/
├── candidate/
│   ├── champion.json
│   ├── promotions/
│   │   └── <promotion-id>.json
│   └── <model-id>/
│       ├── model.pt
│       ├── preprocessing.json
│       └── manifest.json
│
└── anomaly/
    ├── champion.json
    ├── promotions/
    │   └── <promotion-id>.json
    └── <model-id>/
        ├── model.pt
        ├── preprocessing.json
        └── manifest.json
```

---

## 2. Package Immutability & Commit Marker

1. `model.pt` and `preprocessing.json` are verified against the training run manifest SHA-256 hashes prior to registration.
2. `manifest.json` is written last and acts as the atomic commit marker for the model package.
3. Partial model packages without a valid `manifest.json` are never considered registered.

---

## 3. Promotion Policies

### Candidate Vetting (`candidate-promote-pr-auc-v1`)
* **Cold-Start Bootstrap**: When no active champion exists, the first registered and verified candidate model is promoted to champion (`BOOTSTRAP_INITIAL_CHAMPION`).
* **Challenger Comparison**: A challenger is evaluated against the active champion using the frozen Golden Test benchmark. The challenger's Golden PR-AUC (Average Precision) must exceed the champion's Golden PR-AUC by at least $\Delta \ge 0.0$ (`CHALLENGER_OUTPERFORMS_CHAMPION`).

### Astronomical Anomaly Detection (`anomaly-promote-synthetic-v1`)
* **Cold-Start Bootstrap**: The first verified anomaly model is promoted directly to champion.
* **Challenger Comparison**: Challenger must achieve synthetic anomaly detection rate $\ge$ Champion synthetic detection rate while maintaining bounded reference alert rates.

---

## 4. Rollback Policy (`candidate-rollback-v1`, `anomaly-rollback-v1`)

* The champion pointer `models/<task>/champion.json` can be atomically pointed back to any previously registered model package.
* Rollback creates an immutable audit record in `models/<task>/promotions/` with `action="ROLLBACK"` and `comparison_decision="ROLLBACK_RESTORE_CHAMPION"`.
* Existing model packages and training/evaluation runs are never modified or deleted.
