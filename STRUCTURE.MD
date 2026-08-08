# STRUCTURE.md

# AURORA Cosmic Data Platform
# Repository Skeleton

aurora-cosmic/
│
├── README.md
├── ARCH.md
├── STRUCTURE.md
│
├── Makefile
├── docker-compose.yml
├── .env.example
├── .gitignore
├── .dockerignore
├── .editorconfig
│
├── apps/
│   │
│   ├── go-ingester/
│   │   ├── go.mod
│   │   ├── go.sum
│   │   ├── Dockerfile
│   │   │
│   │   ├── cmd/
│   │   │   └── aurora-ingester/
│   │   │       └── main.go
│   │   │
│   │   ├── internal/
│   │   │   ├── app/
│   │   │   │   └── app.go
│   │   │   │
│   │   │   ├── mast/
│   │   │   │   ├── client.go
│   │   │   │   ├── discover.go
│   │   │   │   └── product.go
│   │   │   │
│   │   │   ├── ingest/
│   │   │   │   ├── pipeline.go
│   │   │   │   ├── stream.go
│   │   │   │   └── checksum.go
│   │   │   │
│   │   │   ├── storage/
│   │   │   │   └── minio.go
│   │   │   │
│   │   │   ├── events/
│   │   │   │   └── nats.go
│   │   │   │
│   │   │   └── checkpoint/
│   │   │       └── store.go
│   │   │
│   │   └── README.md
│   │
│   │
│   ├── rust-preprocessor/
│   │   ├── Cargo.toml
│   │   ├── Cargo.lock
│   │   ├── Dockerfile
│   │   │
│   │   ├── src/
│   │   │   ├── main.rs
│   │   │   ├── app.rs
│   │   │   ├── consumer.rs
│   │   │   ├── storage.rs
│   │   │   │
│   │   │   ├── domain/                       # Core domain models (checkpoint, event, failure, lineage)
│   │   │   │   ├── mod.rs
│   │   │   │   ├── checkpoint.rs
│   │   │   │   ├── event.rs
│   │   │   │   ├── failure.rs
│   │   │   │   └── lineage.rs
│   │   │   │
│   │   │   ├── infra/                        # Infrastructure layer (config, logger, minio)
│   │   │   │   ├── mod.rs
│   │   │   │   ├── config.rs
│   │   │   │   ├── logger.rs
│   │   │   │   └── minio.rs
│   │   │   │
│   │   │   ├── fits/
│   │   │   │   ├── mod.rs
│   │   │   │   ├── image.rs
│   │   │   │   └── lightcurve.rs
│   │   │   │
│   │   │   ├── pipeline/
│   │   │   │   ├── mod.rs
│   │   │   │   ├── image.rs
│   │   │   │   └── lightcurve.rs
│   │   │   │
│   │   │   ├── output/
│   │   │   │   ├── mod.rs
│   │   │   │   ├── silver.rs
│   │   │   │   └── gold.rs
│   │   │   │
│   │   │   └── tests/                        # Layered test suite
│   │   │       ├── mod.rs
│   │   │       ├── unit/                     # Unit tests (checkpoint, config, event, failure, fits, lineage, worker)
│   │   │       ├── pipeline/                 # Pipeline tests (image, lightcurve, silver)
│   │   │       └── e2e/                      # End-to-end integration flow
│   │   ├── benches/
│   │   │   └── preprocessing.rs
│   │   │
│   │   └── README.md
│   │
│   │
│   ├── python-ml-worker/
│   │   ├── pyproject.toml
│   │   ├── Dockerfile
│   │   │
│   │   ├── aurora_ml/                        # Main package
│   │   │   ├── __init__.py
│   │   │   ├── main.py                       # CLI entrypoint
│   │   │   ├── config.py                     # Infrastructure config
│   │   │   ├── data.py                       # Generic data loading utils
│   │   │   │
│   │   │   ├── pipeline/                     # Stage 5 — Data Pipeline Layer
│   │   │   │   ├── __init__.py
│   │   │   │   ├── gold.py                   # Gold snapshot identity & manifest
│   │   │   │   ├── features.py               # LC scientific feature engineering
│   │   │   │   ├── evidence.py               # TPF / FFI vetting evidence
│   │   │   │   ├── catalogs.py               # TIC / TOI / TCE catalog enrichment
│   │   │   │   ├── gold_materialize.py       # Gold Parquet materialization
│   │   │   │   ├── feature_checkpoint.py     # Feature engineering progress tracking
│   │   │   │   ├── analytics.py              # ClickHouse analytical projection
│   │   │   │   └── checkpoint.py             # Generic pipeline checkpoint state
│   │   │   │
│   │   │   └── ml/                           # Stage 6 — ML Platform Layer
│   │   │       ├── __init__.py
│   │   │       ├── datasets/                 # ML dataset view & deterministic split
│   │   │       │   ├── __init__.py
│   │   │       │   └── splits.py
│   │   │       ├── candidate/                # Supervised candidate vetting model
│   │   │       │   ├── __init__.py
│   │   │       │   ├── model.py
│   │   │       │   └── train.py
│   │   │       ├── anomaly/                  # Unsupervised anomaly detection
│   │   │       │   ├── __init__.py
│   │   │       │   ├── model.py
│   │   │       │   └── train.py
│   │   │       ├── evaluate.py               # Evaluation: PR-AUC, ROC-AUC, metrics
│   │   │       ├── registry.py               # Champion/Challenger model registry
│   │   │       └── export_onnx.py            # ONNX export & runtime parity
│   │   │
│   │   ├── tests/
│   │   │   ├── fixtures/
│   │   │   │   └── catalogs/
│   │   │   │       ├── tic-small.csv
│   │   │   │       ├── toi-small.csv
│   │   │   │       └── tce-small.csv
│   │   │   ├── pipeline/                     # Stage 5 pipeline unit tests
│   │   │   │   ├── test_analytics.py
│   │   │   │   ├── test_catalogs.py
│   │   │   │   ├── test_evidence.py
│   │   │   │   ├── test_features.py
│   │   │   │   ├── test_gold.py
│   │   │   │   └── test_gold_materialize.py
│   │   │   ├── ml/                           # Stage 6 ML unit tests
│   │   │   │   ├── test_splits.py
│   │   │   │   └── test_training.py
│   │   │   ├── test_config.py
│   │   │   └── test_stage5_e2e.py            # Stage 5 integration test
│   │   │
│   │   └── README.md
│   │
│   │
│   ├── rust-inference/
│   │   ├── Cargo.toml
│   │   ├── Cargo.lock
│   │   ├── Dockerfile
│   │   │
│   │   ├── src/
│   │   │   ├── main.rs
│   │   │   ├── app.rs
│   │   │   ├── model.rs
│   │   │   ├── runtime.rs
│   │   │   ├── prediction.rs
│   │   │   ├── evidence.rs
│   │   │   └── nats.rs
│   │   │
│   │   └── README.md
│   │
│   │
│   ├── go-api/
│   │   ├── go.mod
│   │   ├── go.sum
│   │   ├── Dockerfile
│   │   │
│   │   ├── cmd/
│   │   │   └── aurora-api/
│   │   │       └── main.go
│   │   │
│   │   ├── internal/
│   │   │   ├── app/
│   │   │   │   └── app.go
│   │   │   │
│   │   │   ├── http/
│   │   │   │   ├── router.go
│   │   │   │   ├── targets.go
│   │   │   │   ├── candidates.go
│   │   │   │   ├── anomalies.go
│   │   │   │   └── system.go
│   │   │   │
│   │   │   └── store/
│   │   │       ├── minio.go
│   │   │       └── clickhouse.go
│   │   │
│   │   └── README.md
│   │
│   │
│   └── dashboard/
│       ├── pyproject.toml
│       ├── Dockerfile
│       │
│       ├── app.py
│       ├── api.py
│       │
│       ├── pages/
│       │   ├── overview.py
│       │   ├── targets.py
│       │   ├── lightcurves.py
│       │   ├── candidates.py
│       │   ├── anomalies.py
│       │   └── system.py
│       │
│       └── README.md
│
│
├── contracts/
│   │
│   ├── events/
│   │   ├── bronze-object-ready.schema.json
│   │   ├── preprocess-completed.schema.json
│   │   ├── gold-ready.schema.json
│   │   ├── model-promoted.schema.json
│   │   └── prediction-ready.schema.json
│   │
│   ├── data/
│   │   ├── silver-lightcurve.schema.json
│   │   ├── gold-features.schema.json
│   │   └── prediction.schema.json
│   │
│   └── README.md
│
│
├── config/
│   ├── aurora.example.yaml
│   ├── prometheus.yml
│   └── grafana/
│       └── dashboards/
│
│
├── infra/
│   │
│   ├── minio/
│   │   └── init.sh
│   │
│   ├── nats/
│   │   └── nats.conf
│   │
│   ├── clickhouse/
│   │   └── init.sql
│   │
│   └── grafana/
│       └── provisioning/
│
│
├── datasets/
│   ├── README.md
│   └── examples/
│       └── manifest.example.json
│
│
├── scripts/
│   ├── dev-up.sh
│   ├── dev-down.sh
│   └── smoke-test.sh
│
│
├── tests/
│   ├── fixtures/
│   │   ├── sample-lightcurve.fits
│   │   └── sample-event.json
│   │
│   └── e2e/
│       ├── stage3-preprocessing.sh
│       ├── stage4-recovery-lifecycle.sh
│       └── stage5-gold-analytics.sh
│
│
├── docs/
│   ├── ANALYTICS.md
│   ├── CHECKPOINTS.md
│   ├── CONFIGURATION.md
│   ├── GOLD.md
│   ├── LINEAGE.md
│   ├── STAGE2_VALIDATION.md
│   ├── STAGE3_VALIDATION.md
│   ├── STAGE4_VALIDATION.md
│   ├── STAGE5_VALIDATION.md
│   └── ML_DATASETS.md
│
│
└── .github/
    └── workflows/
        ├── ci.yml
        └── docker.yml


===============================================================================
DATA FLOW ISOLATION
===============================================================================


GO INGESTER

    MAST
      |
      v
    mast/
      |
      v
    ingest/
      |
      +------> storage/minio.go
      |
      +------> events/nats.go
      |
      +------> checkpoint/store.go


No preprocessing code lives here.



RUST PREPROCESSOR

    NATS
      |
      v
    consumer.rs
      |
      v
    FITS parser
      |
      v
    pipeline
      |
      v
    output
      |
      +------> Silver
      |
      +------> Gold


No ML training code lives here.



PYTHON ML WORKER

    Gold
      |
      v
    data.py
      |
      v
    features.py
      |
      +------> transit/
      |
      +------> anomaly/
      |
      v
    evaluate.py
      |
      v
    export_onnx.py
      |
      v
    registry.py


No HTTP API lives here.



RUST INFERENCE

    promoted model
         |
         v
      model.rs
         |
         v
     runtime.rs
         |
         v
    prediction.rs
         |
         v
     evidence.rs


No model training lives here.



GO API

    request
       |
       v
    http/
       |
       v
    store/
       |
       v
    response


No scientific computation lives here.


===============================================================================
CODE ORGANIZATION RULES
===============================================================================


RULE 01

    No global utils/ folder.


RULE 02

    No helpers/ dumping ground.


RULE 03

    Code stays close to the data flow that owns it.


RULE 04

    Share schemas and contracts.

    Do not share service business logic.


RULE 05

    main.go / main.rs / main.py only wires dependencies.

    Business logic must not accumulate in entrypoints.


RULE 06

    Avoid unnecessary interfaces / traits.

    Introduce abstraction only when there are real implementations
    or clear testing boundaries.


RULE 07

    Prefer:

        pipeline.go
        stream.go
        storage.go

    over:

        manager.go
        service.go
        helper.go
        util.go


RULE 08

    One file should have one obvious responsibility.


RULE 09

    Data transformations should be explicit.

    Avoid hidden mutation and magic middleware.


RULE 10

    Keep configuration explicit and centralized.


===============================================================================
ROOT MAKEFILE
===============================================================================


make help

make infra-up

make infra-down

make build

make up

make down

make logs

make ingest

make preprocess

make train

make test

make test-e2e

make benchmark

make fmt

make lint

make clean


The root Makefile coordinates the repository.

Language-specific build details stay inside each application.

Do not turn Makefile into another application framework.


===============================================================================
DOCKER COMPOSE
===============================================================================


docker-compose.yml

    minio

    nats

    clickhouse

    go-ingester

    rust-preprocessor

    python-ml-worker

    rust-inference

    go-api

    dashboard

    prometheus

    grafana


Development starts with:

    make up


Infrastructure only:

    make infra-up


===============================================================================
DOCKERFILE POLICY
===============================================================================


Every application owns its Dockerfile.


apps/go-ingester/Dockerfile

apps/rust-preprocessor/Dockerfile

apps/python-ml-worker/Dockerfile

apps/rust-inference/Dockerfile

apps/go-api/Dockerfile

apps/dashboard/Dockerfile


Use multi-stage builds for Go and Rust.

Python images install only runtime dependencies.

GPU support is isolated to ML/inference images when required.


===============================================================================
GIT
===============================================================================


.gitignore excludes:

    .env

    raw FITS

    Parquet generated locally

    model binaries

    Python caches

    Rust target/

    local MinIO data

    local ClickHouse data

    logs

    IDE files


Never commit:

    *.fits

    *.parquet

    *.onnx

    MinIO volume data

    secrets


Commit:

    schemas

    manifests examples

    configuration examples

    source code

    documentation


===============================================================================
GIT BRANCH STYLE
===============================================================================


main

feature/ingester

feature/preprocessor

feature/ml-transit

feature/ml-anomaly

feature/inference

feature/api

fix/checkpoint-recovery


Keep branches short-lived.

Prefer small commits around one data-flow change.


===============================================================================
CI
===============================================================================


.github/workflows/ci.yml


CI runs:

    Go fmt / vet / test

    Rust fmt / clippy / test

    Python lint / test

    contract validation

    Docker build


Do not download the real 50 GiB dataset in CI.

Use tiny FITS fixtures for integration tests.


===============================================================================
TEST STRATEGY
===============================================================================


Unit tests:

    live inside each application


Integration tests:

    use local MinIO + NATS


End-to-end:

    tests/e2e/pipeline.sh


E2E fixture flow:

    sample FITS
        |
        v
    MinIO Bronze
        |
        v
    NATS event
        |
        v
    Rust
        |
        v
    Silver / Gold
        |
        v
    model / prediction


===============================================================================
CONTRACT OWNERSHIP
===============================================================================


contracts/ is the only intentionally shared code-adjacent area.


It defines:

    event shape

    data schema

    prediction shape


It does NOT define:

    Go libraries

    Rust crates

    Python utility packages


Each service reads the contract
and implements its own language-native representation.


===============================================================================
MINIMAL DEPENDENCY DIRECTION
===============================================================================


             contracts
                 ^
                 |
     +-----------+-----------+
     |           |           |
     |           |           |
    Go          Rust       Python


Applications do not import each other.


Bad:

    go-api
      |
      v
    go-ingester/internal/foo


Good:

    go-api
      |
      v
    contracts + MinIO/NATS/DB


===============================================================================
FINAL SKELETON PRINCIPLE
===============================================================================


                    aurora-cosmic
                          |
          +---------------+---------------+
          |               |               |
          v               v               v
        apps           contracts         infra
          |               |               |
          v               v               v
       compute          schemas        runtime
          |
    +-----+------+------------+-------------+
    |            |            |             |
    v            v            v             v
 ingester    preprocessor     ML         serving


Repository philosophy:

    small folders

    explicit files

    explicit data flow

    minimal shared code

    no generic helper layer

    no hidden framework

    no cross-service imports

    contracts over coupling

    data flow over abstraction


===============================================================================
END
===============================================================================