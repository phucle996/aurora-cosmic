# Python ML Worker Service

`aurora_ml` reads Gold Parquet dataset snapshots from MinIO, trains/evaluates Exoplanet Candidate and Anomaly Detection models (utilizing GPU 4 GB VRAM budget when available), exports ONNX artifacts, and registers models in MinIO Model Registry.

## Package Layout

* `aurora_ml/main.py` — Entrypoint
* `aurora_ml/data.py` — Gold dataset snapshot loader & splitters
* `aurora_ml/checkpoint.py` — Training progress checkpoint store
* `aurora_ml/features.py` — Scientific feature transformations
* `aurora_ml/transit/` — Exoplanet transit candidate classification model & trainer
* `aurora_ml/anomaly/` — Light curve anomaly detection model & trainer
* `aurora_ml/evaluate.py` — Model evaluation metrics (ROC-AUC, PR-AUC)
* `aurora_ml/registry.py` — MinIO Model Registry manager & Champion/Challenger promoter
* `aurora_ml/export_onnx.py` — ONNX model exporter
* `tests/` — Training pipeline unit tests
