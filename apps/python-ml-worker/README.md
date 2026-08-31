# Python ML Worker Service

`aurora_ml` owns the Stage 6 ML boundary: deterministic datasets and splits,
training, evaluation, runtime package export and model registry artifacts.
Gold construction belongs to the dedicated Gold Builder service.

Each dashboard request explicitly selects CPU or GPU. A GPU request fails when
the configured worker cannot provide CUDA; it never silently falls back to CPU.

## Package Layout

```
aurora_ml/
├── service.py                      # systemd/Docker entrypoint; durable JetStream consumer
├── config.py                       # Infrastructure config (MinIO, ClickHouse, env)
├── domain/                         # Immutable request contracts and invariants
├── application/                    # Training orchestration with scientific provenance checks
├── infrastructure/                 # MinIO durable state and artifact adapters
├── observer/                       # Bounded Prometheus metrics and /healthz server
│   └── metrics.py                  # Seven worker-level metric families, no ID labels
├── data.py                         # Generic Gold data loading & lineage discovery
│
├── pipeline/                       # Shared Gold contracts and feature schemas
│   ├── gold.py                     # Gold snapshot identity model, Silver input refs, manifest planner
│   ├── features.py                 # LC Scientific Feature Engineering (lc-features-v1), BLS transit search
│   ├── evidence.py                 # TPF Vetting Evidence (tpf-vetting-v1), FFI Context Evidence (ffi-evidence-v1)
│   ├── catalogs.py                 # TIC/TOI/TCE catalog snapshots, ephemeris matching, label versioning
│   ├── gold_materialize.py         # PyArrow schemas, ZSTD Parquet materializer, manifest commit
│   ├── feature_checkpoint.py       # Stage 5 Gold materialization recovery checkpoints
│   ├── analytics.py                # ClickHouse analytical query index loader (analytics-query-index-v1)
│   └── checkpoint.py               # Generic pipeline checkpoint state
│
└── ml/                             # Stage 6 — ML Platform Layer
    ├── datasets/
    │   └── splits.py               # ML dataset view (candidate-ml-view-v1), group-safe split (candidate-group-split-v1)
    ├── candidate/                  # Supervised candidate vetting model & trainer
    ├── anomaly/                    # Unsupervised anomaly detection model & trainer
    ├── evaluate.py                 # Evaluation metrics: ROC-AUC, PR-AUC, Confusion Matrix
    ├── registry.py                 # MinIO Model Registry, Champion/Challenger promoter
    └── export_onnx.py              # ONNX model exporter & runtime parity validator
```

## Tests Layout

```
tests/
├── fixtures/catalogs/              # CSV fixtures: tic-small.csv, toi-small.csv, tce-small.csv
├── pipeline/                       # Stage 5 unit tests (features, evidence, catalogs, gold, gold_materialize, analytics)
├── ml/                             # Stage 6 unit tests (splits, training)
├── test_config.py                  # Config unit test
└── test_stage5_e2e.py              # Stage 5 end-to-end integration test
```

## Operation

There is no operator CLI. Run `python -m aurora_ml.service` through systemd or
Docker; the dashboard publishes an explicit training request to
`aurora.v1.ml.training.requested` in JetStream. The worker accepts only a
committed Gold snapshot and real labels/features. It writes a durable job
journal, immutable training/evaluation/model/runtime artifacts to MinIO, and
then dispatches an inference job. Rust validates ONNX parity before scoring and
persists that validation evidence; model promotion still requires human review.

## Observer

The long-running worker exposes `AURORA_METRICS_ADDR` (default
`0.0.0.0:8083`) with `/metrics` for Prometheus and `/healthz` for container
health checks. Metrics are intentionally low-cardinality and cover job outcomes,
duration, errors, in-flight work, queue depth, processed rows, and the last
successful job timestamp. Runtime IDs and object paths are never labels.
