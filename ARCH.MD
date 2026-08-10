# ARCH.md

# AURORA Cosmic Data Platform

1. OVERVIEW

AURORA is a continuously evolving astronomical data platform built around
NASA TESS observations.

The platform does not attempt to store the complete TESS archive locally.

Instead, AURORA continuously:

    ingest new astronomical data
        ->
    preprocess FITS
        ->
    build analytical datasets
        ->
    train / evolve ML models
        ->
    remove old raw data
        ->
    ingest newer data


Raw FITS storage is bounded to approximately:

    ~50 GiB

while the total amount of data processed over the lifetime of the platform
may grow far beyond local storage capacity.


2. CORE ARCHITECTURE


                              NASA / MAST
                           TESS Data Archive
                                  |
                                  |
                               HTTPS
                                  |
                                  v
                         +------------------+
                         |   GO INGESTER    |
                         |                  |
                         | discover         |
                         | stream download  |
                         | checkpoint       |
                         +----+--------+----+
                              |        |
                         DATA |        | EVENT
                              |        |
                              v        v
                       +-----------+  +------------+
                       |   MINIO   |  |    NATS    |
                       |  BRONZE   |  | JETSTREAM  |
                       |           |  |            |
                       | raw FITS  |  | jobs       |
                       | ~50 GiB   |  | events     |
                       +-----+-----+  +------+-----+
                             |               |
                             +-------+-------+
                                     |
                                     v
                         +----------------------+
                         |  RUST PREPROCESSOR   |
                         |                      |
                         | Tokio concurrency    |
                         | FITS preprocessing   |
                         | feature extraction   |
                         +----------+-----------+
                                    |
                          +---------+---------+
                          |                   |
                          v                   v
                   +-------------+     +-------------+
                   |   SILVER    |     |    GOLD     |
                   |             |     |             |
                   | Parquet     |     | ML features |
                   | normalized  |     | statistics  |
                   +------+------+     +------+------+
                          |                   |
                          +---------+---------+
                                    |
                                    v
                         +----------------------+
                         |   PYTHON ML WORKER   |
                         |                      |
                         | train / evaluate     |
                         | CUDA acceleration    |
                         | ONNX export          |
                         +----------+-----------+
                                    |
                                    v
                         +----------------------+
                         |    MINIO MODELS      |
                         |                      |
                         | model.onnx           |
                         | metrics              |
                         | versions             |
                         +----------+-----------+
                                    |
                                    v
                         +----------------------+
                         |   RUST INFERENCE     |
                         |                      |
                         | ONNX Runtime         |
                         | CPU / CUDA           |
                         | model hot swap       |
                         +----------+-----------+
                                    |
                                    v
                         +----------------------+
                         |        GO API        |
                         +----------+-----------+
                                    |
                                    v
                         +----------------------+
                         |      DASHBOARD       |
                         +----------------------+


3. SOURCE DATA


Primary source:

    NASA TESS
        |
        v
    MAST / STScI


Primary data products:

    Target Pixel File
        *_tp.fits

    Light Curve
        *_lc.fits

    Calibrated Full Frame Image
        *_ffic.fits


Metadata / labels:

    TIC
    TOI
    TCE


Primary logical sample:

    TIC_ID + Sector
           |
           +-- Target Pixel FITS
           |
           +-- Light Curve FITS
           |
           +-- metadata
           |
           +-- label / candidate information


4. GO INGESTER


                         MAST
                           |
                           v
                     GO INGESTER
                       /       \
                      /         \
                     v           v
                  MinIO         NATS


Go is responsible for external data acquisition.

FITS data is streamed directly from MAST into MinIO Bronze.

After an object is safely stored, Go publishes a lightweight NATS event.

Go also maintains ingestion progress so the service can resume after restart.


5. NATS JETSTREAM


NATS is the control / event plane.


    Go
     |
     v
    NATS
     |
     v
    Rust
     |
     v
    ML / Inference


NATS carries:

    object-ready events

    preprocessing jobs

    ML events

    model promotion events

    retry / failure events


NATS does NOT carry large FITS binaries.

Messages reference objects stored in MinIO.


6. MINIO DATA LAKE


s3://aurora/

    bronze/

    silver/

    gold/

    models/

    predictions/

    checkpoints/

    manifests/

    labels/


Bronze:

    source FITS
    rolling ~50 GiB


Silver:

    cleaned / normalized datasets
    primarily Parquet


Gold:

    cumulative analytical and ML features


Models:

    versioned ONNX models


Checkpoints / manifests:

    durable system progress and data lineage


7. ROLLING RAW DATA


                     MAST
                       |
                       v
                 new raw data
                       |
                       v
              +----------------+
              | MinIO Bronze   |
              |                |
              | max ~50 GiB    |
              +-------+--------+
                      |
                      v
              Rust preprocessing
                      |
                      v
                Silver / Gold
                      |
                      v
                 raw eligible
                 for deletion
                      |
                      v
                   cleanup
                      |
                      v
                ingest newer data


50 GiB is a storage budget, not the total dataset size.

Historical raw FITS may be deleted after successful processing.

Manifests, Gold features, labels and model history are preserved.


8. RUST PREPROCESSOR


                         NATS
                           |
                           v
                  +------------------+
                  | Rust Preprocessor|
                  +--------+---------+
                           |
                        Tokio
                           |
                    bounded tasks
                     /     |     \
                    v      v      v
                   T1     T2     TN
                    \      |      /
                     +-----+-----+
                           |
                           v
                    FITS processing
                           |
                           v
                     Silver / Gold


Rust performs deterministic preprocessing.

Tokio is used for bounded concurrent task execution and async I/O.

CPU-heavy FITS work is isolated from the async runtime where necessary.

The worker writes derived data back to MinIO.


9. CHECKPOINTS


                    MinIO
                      |
                checkpoints/
                 /    |     \
                /     |      \
               v      v       v
           ingest  preprocess  ML


Core rule:

    NATS remembers what still needs to happen.

    MinIO checkpoints remember what has already happened.


Each major subsystem keeps durable progress.

Services can crash and restart without restarting the whole pipeline.

Checkpoints also support idempotent processing.


10. DATA LIFECYCLE


    DISCOVERED
        |
        v
    BRONZE_READY
        |
        v
    PREPROCESSED
        |
        v
    SILVER_READY
        |
        v
    GOLD_READY
        |
        v
    CHECKPOINTED
        |
        v
    EVICTABLE
        |
        v
    RAW_DELETED


Raw FITS can only be removed after downstream artifacts are safely persisted.

Raw deletion never removes lineage information.

The lifecycle keeps local storage bounded while knowledge continues growing.


11. ML PLATFORM


                         MINIO GOLD
                              |
                              v
                    +-------------------+
                    | Python ML Worker  |
                    |                   |
                    | train             |
                    | evaluate          |
                    | CUDA              |
                    +---------+---------+
                              |
                              v
                         model.onnx
                              |
                              v
                    +-------------------+
                    | Rust Inference    |
                    |                   |
                    | ONNX Runtime      |
                    | CPU / CUDA        |
                    +---------+---------+
                              |
                              v
                           Go API


Primary ML tasks:

    exoplanet candidate vetting

    false-positive detection

    astronomical anomaly detection


Python owns training and experimentation.

Rust owns production inference.

Go exposes results through the API.


12. MODEL EVOLUTION


                 cumulative Gold data
                         |
                         v
                  Python training
                         |
                         v
                    Challenger
                         |
                         v
                    Evaluation
                     /       \
                    /         \
                   v           v
                Reject      Promote
                              |
                              v
                           Champion


New data does not automatically replace the deployed model.

New models must outperform or satisfy evaluation requirements.

Previous model versions remain available for rollback.

Model evolution continues while raw storage remains bounded.


13. GPU ACCELERATION


                     ~4 GiB VRAM
                          |
                 +--------+--------+
                 |                 |
                 v                 v
          Python ML Worker   Rust Inference
                 |                 |
              CUDA           CUDA optional
                 |                 |
                 +--------+--------+
                          |
                     CPU fallback


Primary GPU workloads:

    1D CNN for light curves

    small TPF image models

    anomaly autoencoders

    optional GPU gradient boosting

    optional ONNX inference


Full-size FFI images are not directly trained as giant GPU tensors.

GPU acceleration is optional.

The complete system must remain functional on CPU.


14. LANGUAGE RESPONSIBILITIES


GO

    external ingestion
    network I/O
    lifecycle coordination
    API services


RUST

    FITS preprocessing
    concurrent processing
    data transformation
    production ML inference


PYTHON

    scientific analysis
    feature experiments
    ML training
    model evaluation


15. SYSTEM STATE


Persistent data:

    MinIO


Pending work:

    NATS JetStream


Processing:

    Go + Rust + Python


Acceleration:

    CUDA GPU when available


The architecture separates:

    DATA
      |
      v
    MinIO


    EVENTS
      |
      v
    NATS


    COMPUTE
      |
      v
    Go / Rust / Python


16. NO SPARK


Spark is not required.


Parallel network ingestion:

    Go goroutines


Distributed job coordination:

    NATS JetStream


Concurrent preprocessing:

    Rust + Tokio


CPU-heavy parallelism:

    Rust worker pool / Rayon if required


Persistent object storage:

    MinIO


Columnar storage:

    Parquet / Arrow


Checkpointing:

    MinIO


Machine learning:

    Python


Inference:

    Rust


AURORA focuses on implementing the data-system mechanics directly
instead of introducing a general-purpose distributed compute framework.


17. CORE SYSTEM RULES


1.

    Large FITS binaries never travel through NATS.


2.

    Raw data must exist in MinIO before an object-ready event is published.


3.

    Preprocessing concurrency must always be bounded.


4.

    Processing must be idempotent.


5.

    Raw FITS can only be deleted after successful downstream persistence.


6.

    Checkpoints and manifests survive raw-data deletion.


7.

    Gold datasets accumulate across raw-data windows.


8.

    Model versions are immutable.


9.

    New models start as challengers.


10.

    GPU acceleration is optional and must have CPU fallback.


18. CORE DATA FLOW


                          NASA / MAST
                               |
                               v
                         GO INGESTER
                         /          \
                        /            \
                       v              v
                 MINIO BRONZE       NATS
                       |              |
                       +------+-------+
                              |
                              v
                      RUST PREPROCESSOR
                              |
                         +----+----+
                         |         |
                         v         v
                      SILVER      GOLD
                                   |
                                   v
                           PYTHON ML WORKER
                                   |
                                   v
                             MODEL REGISTRY
                                   |
                                   v
                            RUST INFERENCE
                                   |
                                   v
                                GO API
                                   |
                                   v
                              DASHBOARD


                          SYSTEM MEMORY
                               |
                               v
                              MINIO
                               |
              +----------------+----------------+
              |                |                |
              v                v                v
          checkpoints       manifests         models

