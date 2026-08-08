# Python ML Worker Service

`aurora_ml` owns:
- **Stage 5** — Scientific Feature Engineering, Gold Snapshot materialization, Catalog enrichment, and ClickHouse analytical index
- **Stage 6** — ML Dataset boundary, deterministic group split, Candidate Vetting & Anomaly Detection model training, ONNX export, and Model Registry

## Package Layout

```
aurora_ml/
├── main.py                         # CLI entrypoint (gold-plan, gold-build, analytics-load, ml-view, ml-split)
├── config.py                       # Infrastructure config (MinIO, ClickHouse, env)
├── data.py                         # Generic Gold data loading & lineage discovery
│
├── pipeline/                       # Stage 5 — Data Pipeline Layer
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

## CLI Commands

```bash
# Stage 5 — Gold Pipeline
python -m aurora_ml.main gold-plan   --type CANDIDATE --gold-schema gold-candidate-v1
python -m aurora_ml.main gold-build  --plan plan.json [--set-current] [--dry-run]
python -m aurora_ml.main analytics-load --snapshot-id gold-v1-<id> [--rebuild]

# Stage 6 — ML Platform
python -m aurora_ml.main ml-view   --snapshot-id gold-v1-<id>
python -m aurora_ml.main ml-split  --snapshot-id gold-v1-<id> [--seed 42]
```
