# Anomaly Light-Curve Dataset View Contract (V1)

**Version**: `anomaly-lightcurve-ml-view-v1`  
**Status**: FROZEN  
**Schema Version**: 1  

## Goal

Defines the reproducible, target-group-safe dataset view specification for unsupervised astronomical anomaly detection trained from committed Gold anomaly snapshots (`gold-anomaly-v1`).

---

## Model Input Features (14 Frozen Scalar LC Features)

1. `n_points` (int)
2. `time_span` (float)
3. `median_cadence` (float)
4. `max_gap` (float)
5. `flux_mean` (float)
6. `flux_median` (float)
7. `flux_std` (float)
8. `flux_mad` (float)
9. `flux_robust_sigma` (float)
10. `flux_amplitude` (float)
11. `flux_rms` (float)
12. `flux_skewness` (float)
13. `flux_kurtosis` (float)
14. `median_flux_err` (float)

---

## Excluded Fields (Identity & Audit Context)

- `source_product_id`, `lineage_id`, `sample_id`, `tic_id`, `sector`
- `silver_sha256`, `lc_feature_version`, `lc_feature_fingerprint`
- All TOI/TCE label metadata (unsupervised policy)

---

## Fingerprint Invariant

Fingerprint SHA-256 is computed over:
- `anomaly-lightcurve-ml-view-v1`
- Canonical JSON of `snapshot_id`, `manifest_sha256`, `feature_names`, sorted list of eligible `product_ids`.
