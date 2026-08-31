# AURORA Rust Preprocessor

`aurora-preprocessor` is the Bronze-to-Silver processing service. It consumes
verified Bronze FITS events from NATS JetStream, reads the referenced object
from MinIO, performs deterministic scientific preprocessing, writes a versioned
Parquet artifact to Silver, commits checkpoint and lineage records, publishes a
Silver-ready event, and only then acknowledges the Bronze message.

The worker stays idle after startup until the control plane publishes a start
command on `AURORA_PREPROCESS_CONTROL_SUBJECT` (default
`aurora.v1.preprocessing.control`). The dashboard exposes this as the
**Start preprocessing** button. `stream` mode follows new Bronze events;
`batch` mode drains retained Bronze events. Run checkpoints are written under
`checkpoints/preprocessing/`, independently from ingestion checkpoints.

## Runtime flow

```text
NATS JetStream: AURORA_BRONZE
        |
        v
aurora.v1.bronze.*.ready
        |
        v
durable pull consumer + bounded Tokio worker pool
        |
        +--> Stat Bronze object and verify event size
        +--> Stream Bronze FITS to a temporary file
        +--> Verify downloaded byte count and SHA-256
        +--> Decode FITS with CFITSIO
        +--> Run product-specific scientific preprocessing
        +--> Serialize Arrow RecordBatch to ZSTD Parquet
        +--> Upload and stat-verify Silver artifact
        +--> Commit checkpoint and immutable lineage
        +--> Publish aurora.v1.silver.*.ready
        +--> ACK Bronze message
```

At startup the service ensures the durable `AURORA_SILVER` stream for
`aurora.v1.silver.>` exists before consuming Bronze work. This keeps Silver
event publication safe even when the ingester and preprocessor start in either
order.

The worker retries startup while the configured JetStream stream or durable
consumer is not available. A fetched batch is fully scheduled; messages are not
discarded just because they arrived in the same pull response. The worker pool
is bounded by `AURORA_PREPROCESS_WORKERS`.

## Scientific preprocessing

### Light Curve (`LIGHT_CURVE`)

1. Select `PDCSAP_FLUX`; optionally fall back to `SAP_FLUX`.
2. Remove non-finite flux/time values and, in `strict` mode, rows whose quality
   flag is not zero.
3. Sort by time and remove duplicate timestamps.
4. Require at least `AURORA_LC_MIN_POINTS` usable cadences.
5. Compute the flux median and emit normalized flux `(flux / median) - 1`.
6. Normalize flux errors with the same median.
7. Optionally sigma-clip outliers using `AURORA_LC_SIGMA_CLIP`.

The Silver schema is `silver-lightcurve-v1` with `time`, `flux`, `flux_err`, and
`quality` columns. The processor version is `lc-preprocess-v1`.

### Target Pixel File (`TARGET_PIXEL`)

1. Remove invalid times and, in `strict` mode, non-zero quality rows.
2. Calculate the reference level per pixel in bounded cadence chunks with
   `chunk-temporal-median`, or preserve finite input values with `none`.
3. For median modes, emit `(pixel / reference) - 1`; invalid or non-positive
   references produce a safe neutral value of zero.
4. Serialize each cadence as a row with flattened row-major pixel values and
   explicit `rows`/`cols` dimensions.

The Silver schema is `silver-target-pixel-v1`. The processor version is
`tpf-preprocess-v1`.

### Full Frame Image (`FFI`)

The runtime currently persists compact normalized-image statistics rather than the full image:
width, height, finite-pixel count/fraction, median, mean, standard deviation,
minimum, and maximum. Non-finite pixels are excluded from the statistics.
Optional cutout extraction is available in the library API, but the event worker
does not request cutouts because `silver-ffi-v1` has no cutout column.

`AURORA_FFI_NORMALIZATION=median` transforms finite pixels to
`(pixel / median) - 1` before calculating statistics and cutouts; `none`
preserves the source flux scale. The processor version is `ffi-preprocess-v2`.

## Durability and recovery

For every product, the service stores a checkpoint at:

```text
checkpoints/preprocessing/objects/<checkpoint-id>.json
```

and a permanent lineage record under:

```text
lineage/v1/tess/<product-kind>/<lineage-id>.json
```

Recovery first verifies the Bronze checksum and any existing Silver artifact.
Completed Silver artifacts are reused only when the source checksum, processor
version, and output-affecting configuration fingerprint all match. A
failed MinIO/NATS operation is NAKed for JetStream redelivery; deterministic
decode or scientific-quality failures are persisted as terminal failures.

The Bronze message is ACKed only after Silver durability, checkpoint, lineage,
and Silver-event publication succeed. This prevents downstream consumers from
missing a valid Silver artifact.

## Observer metrics

The service exposes a deliberately small Prometheus surface on
`AURORA_METRICS_ADDR` (default `0.0.0.0:8082`):

* `/healthz` — process health
* `/metrics` — terminal product counts, processing duration, failures, worker
  concurrency, fetched queue depth, Bronze/Silver bytes, and last success time

The only labels are bounded product kind, terminal status, and pipeline stage;
product IDs, object keys, and source URLs are never emitted as labels.

## Storage layout

```text
silver/tess/lightcurve/processor=lc-preprocess-v1/config=<sha256>/sector=0042/tic=<tic>/<source>.parquet
silver/tess/target-pixel/processor=tpf-preprocess-v2-chunked/config=<sha256>/sector=0042/tic=<tic>/<source>.parquet
silver/tess/ffi/processor=ffi-preprocess-v2/config=<sha256>/sector=0042/camera=<camera>/ccd=<ccd>/<source>.parquet
```

All Silver objects include source identity, processor/schema versions, Bronze
object key, Bronze SHA-256, and Silver SHA-256 metadata.

## Configuration

| Variable | Required | Default | Meaning |
|---|---:|---|---|
| `AURORA_ENV` | yes | — | Runtime environment |
| `AURORA_LOG_LEVEL` | yes | — | `trace`, `debug`, `info`, `warn`, or `error` |
| `NATS_URL` | yes | — | NATS server URL |
| `MINIO_ENDPOINT` | yes | — | S3/MinIO endpoint |
| `MINIO_ACCESS_KEY` | yes | — | MinIO access key |
| `MINIO_SECRET_KEY` | yes | — | MinIO secret key |
| `MINIO_BUCKET` | yes | — | Default data bucket |
| `AURORA_METRICS_ADDR` | no | `0.0.0.0:8082` | Prometheus observer and health endpoint |
| `AURORA_PREPROCESS_WORKERS` | yes | — | Maximum concurrent products; must be at least 1 |
| `AURORA_PREPROCESS_STREAM` | no | `AURORA_BRONZE` | JetStream stream name |
| `AURORA_PREPROCESS_DURABLE` | no | `aurora-rust-preprocessor` | Durable consumer name |
| `AURORA_PREPROCESS_ACK_WAIT` | no | `5m` | JetStream acknowledgement wait |
| `AURORA_PREPROCESS_MAX_DELIVERIES` | no | `5` | Maximum redeliveries |
| `AURORA_PREPROCESS_RETRY_BACKOFF` | no | `5,30,120,600` | Redelivery backoff seconds |
| `AURORA_PREPROCESS_SHUTDOWN_TIMEOUT` | no | `30` | Graceful drain timeout |
| `AURORA_PREPROCESS_TMP_DIR` | no | `/tmp/aurora-preprocessor` | FITS/Parquet staging directory |
| `AURORA_LC_MIN_POINTS` | no | `100` | Minimum usable LC cadences |
| `AURORA_LC_QUALITY_MODE` | no | `strict` | `strict` or `none` |
| `AURORA_LC_ALLOW_SAP_FALLBACK` | no | `false` | Allow SAP flux fallback |
| `AURORA_LC_SIGMA_CLIP` | no | disabled | Positive sigma threshold |
| `AURORA_TPF_QUALITY_MODE` | no | `strict` | `strict` or `none` |
| `AURORA_TPF_NORMALIZATION` | no | `chunk-temporal-median` | `chunk-temporal-median` or `none`; both are bounded-memory modes. |
| `AURORA_TPF_CHUNK_CADENCES` | no | `256` | TPF cadence rows read and written per bounded-memory chunk. |
| `AURORA_FFI_NORMALIZATION` | no | `median` | Recorded metadata mode: `median` or `none` |

## Build and test

CFITSIO is built from the pinned source dependency, so a host-level
`cfitsio-dev` package is not required for development or systemd execution.

```bash
cargo test --all-targets
```

The test suite covers configuration, event contracts, FITS decoding, LC/TPF/FFI
preprocessing, deterministic Silver keys, Parquet round-trips, checkpoints,
lineage, failure classification, and bounded worker behavior.
