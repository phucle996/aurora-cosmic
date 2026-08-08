# Python ML Worker Service

`aurora_ml` owns Stage 5 Scientific Feature Engineering and Gold Snapshot planning (reading Silver Parquet artifacts + permanent Lineage) as well as Stage 6 Model Training (Exoplanet Candidate & Anomaly Detection models using GPU 4 GB VRAM budget when available), exporting ONNX artifacts, and registering models in MinIO Model Registry.

## Package Layout

* `aurora_ml/main.py` — Entrypoint
* `aurora_ml/gold.py` — Gold snapshot identity model, Silver input refs, and manifest planner
* `aurora_ml/data.py` — Gold dataset snapshot loader & lineage discovery
* `aurora_ml/checkpoint.py` — Training progress checkpoint store
* `aurora_ml/features.py` — Light Curve Scientific Feature Engineering (`lc-features-v1`), Astropy BoxLeastSquares transit search, and robust statistics
* `aurora_ml/evidence.py` — TPF Vetting Evidence (`tpf-vetting-v1`), Transit Deficit Centroid localization, and FFI Context Evidence (`ffi-evidence-v1`)
* `aurora_ml/catalogs.py` — Astronomical catalog snapshots (TIC, TOI, TCE), candidate ephemeris matching (`toi-match-v1`), and conservative label versioning (`candidate-label-policy-v1`)
* `aurora_ml/feature_checkpoint.py` — Stage 5 Gold materialization recovery checkpoints (`checkpoints/feature-engineering/`)
* `aurora_ml/gold_materialize.py` — PyArrow explicit schemas, ZSTD Parquet materializer, SHA-256 partition content digests, manifest commit, and current production pointers
* `aurora_ml/analytics.py` — ClickHouse analytical query index loader (`analytics-query-index-v1`), partition projection, aggregate verification, and READY status manager
* `aurora_ml/transit/` — Exoplanet transit candidate classification model & trainer
* `aurora_ml/anomaly/` — Light curve anomaly detection model & trainer
* `aurora_ml/evaluate.py` — Model evaluation metrics (ROC-AUC, PR-AUC)
* `aurora_ml/registry.py` — MinIO Model Registry manager & Champion/Challenger promoter
* `aurora_ml/export_onnx.py` — ONNX model exporter
* `tests/` — Training, snapshot planning, LC feature, spatial evidence, catalog enrichment, Gold materialization, and ClickHouse analytics unit tests
