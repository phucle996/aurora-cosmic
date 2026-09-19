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

## Scientific Preprocessing

The preprocessing engine transforms raw FITS observational data into calibrated, schema-validated Silver Parquet tables. All algorithms are engineered for numerical determinism, bounded memory footprint, zero-copy inner loops, and high-throughput serialization.

---

### 1. Light Curve Pipeline (`LIGHT_CURVE`)

Light curves contain high-cadence photometric measurements extracted from aperture photometry. The pipeline executes through 5 sequential footsteps:

```
Raw FITS Table
  │
  ▼ [Footstep 1: Quality Masking & Finite Filtering]
  │  - Primary: PDCSAP_FLUX; Fallback: SAP_FLUX (if configured)
  │  - Filter NaN/Inf in (time, flux, flux_err) and non-positive timestamps
  │  - Strict Mode: filter quality != 0 (spacecraft thruster firings, cosmic rays)
  ▼
  ▼ [Footstep 2: Temporal Ordering & Deduplication]
  │  - Monotonic sort by BJD timestamp: O(n log n)
  │  - Deduplicate duplicate timestamps, preserving first observation
  │  - Guard: assert remaining points >= AURORA_LC_MIN_POINTS (default 100)
  ▼
  ▼ [Footstep 3: Quickselect Median Normalization]
  │  - Median estimation via O(n) Quickselect (select_nth_unstable_by)
  │  - Guard: verify median > 0.0 and finite
  │  - Normalized flux: F_norm = (F / median) - 1.0 (zero-centered fractional change)
  │  - Normalized error: σ_norm = σ / median
  ▼
  ▼ [Footstep 4: Robust Sigma Clipping (Iterative Outlier Rejection)]
  │  - When AURORA_LC_SIGMA_CLIP is set (e.g., 3.0σ):
  │  - Compute standard deviation over normalized baseline
  │  - Reject non-transit instrumental anomalies: |F_norm| > k * σ
  │  - Preserves deep planetary transit signals while rejecting positive spikes
  ▼
  ▼ [Footstep 5: Parquet Serialization & In-Flight Streaming Hash]
  │  - Arrow Schema: `silver-lightcurve-v1` (time: Float64, flux: Float32, flux_err: Float32, quality: Int32)
  │  - Fast ZSTD Level 1 compression (2.5x higher write throughput)
  │  - HashingWriter computes SHA-256 and byte counts in-flight (zero disk re-reads)
  │  - Deterministic MinIO Object Key:
  │    silver/tess/lightcurve/processor=lc-preprocess-v1/config={fp}/sector={s}/tic={tic}/{id}.parquet
```

#### Detailed Light Curve Footsteps

1. **Footstep 1: Quality Masking & Finite Filtering**
   - **Flux Column Selection**: Selects Pre-search Data Conditioning SAP (`PDCSAP_FLUX`) as the primary astronomical authority. If missing and `AURORA_LC_ALLOW_SAP_FALLBACK=true`, safely falls back to Simple Aperture Photometry (`SAP_FLUX`); otherwise, emits a typed scientific rejection `missing_pdcsap`.
   - **Finite Validation**: Excludes all cadences where timestamp $t$, flux $F$, or uncertainty $\sigma$ are non-finite (`NaN`, `+Inf`, `-Inf`) or non-positive ($t \le 0$).
   - **Quality Masking**: In `strict` quality mode (default), drops rows where the bitmask `QUALITY != 0`, eliminating artifacts caused by reaction wheel desaturation, Earth/Moon pointings, cosmic ray hits, and coarse spacecraft pointing jitter. In `none` mode, retains all cadences.

2. **Footstep 2: Temporal Ordering & Deduplication**
   - **Monotonic Sorting**: Sorts cadences ascending by Barycentric Julian Date ($t$).
   - **Deduplication**: Drops cadences with duplicate timestamps, retaining the initial observation record to guarantee strict monotonic temporal progression.
   - **Threshold Guard**: Validates that the surviving cadence count satisfies $N \ge \text{AURORA\_LC\_MIN\_POINTS}$ (default 100). Datasets failing this threshold are classified as `insufficient_points` and persisted as terminal rejections.

3. **Footstep 3: Quickselect Median Normalization**
   - **$O(n)$ Quickselect**: Replaces legacy $O(n \log n)$ full sorting with standard library `select_nth_unstable_by`. This reduces median calculation latency by over **90%** (36.8 µs vs 380 µs for 15k cadences).
   - **Sanity Verification**: Ensures calculated median $M > 0.0$ and is finite. A non-positive median triggers an immediate rejection `normalization_median_zero`.
   - **Fractional Flux Emission**: Calculates zero-centered fractional flux variation and scales photometric uncertainties:
     $$\tilde{F}_i = \frac{F_i}{M} - 1.0, \quad \tilde{\sigma}_i = \frac{\sigma_i}{M}$$

4. **Footstep 4: Robust Sigma Clipping**
   - When enabled via `AURORA_LC_SIGMA_CLIP` (e.g. $3.0\sigma$), computes population standard deviation over the normalized flux series.
   - Points satisfying $|\tilde{F}_i| > k \cdot \sigma$ are tagged as statistical outliers. High positive spikes (instrumental flaring, scattered light) are rejected, while preserving negative asymmetric transit profiles.

5. **Footstep 5: Parquet Serialization & In-Flight Streaming Hash**
   - Serializes rows into Apache Arrow `silver-lightcurve-v1` format (`time: Float64`, `flux: Float32`, `flux_err: Float32`, `quality: Int32`).
   - Applies ZSTD Level 1 compression, achieving optimal throughput for floating-point time-series.
   - Uses `HashingWriter<W: Write>` wrapping the file stream directly to compute the SHA-256 checksum and byte count in real time, completely eliminating secondary disk re-reading.

---

### 2. Target Pixel File Pipeline (`TARGET_PIXEL`)

Target Pixel Files (TPF) consist of 3D spatial image cubes (time $\times$ row $\times$ column) covering a postage stamp around target stars. To handle multi-GB TPF files without memory exhaustion, the pipeline executes in bounded cadence chunks:

```
Raw FITS Table HDU 1
  │
  ▼ [Footstep 1: Quality Masking & Cadence Indexing]
  │  - Stream cadence tables via TargetPixelChunkReader
  │  - Discard cadences with non-finite/non-positive times
  │  - In strict mode, filter QUALITY != 0
  ▼
  ▼ [Footstep 2: Temporal Median Reference Level per Pixel]
  │  - Process across bounded chunks (AURORA_TPF_CHUNK_CADENCES, default 256-500)
  │  - For each (row, col) coordinate across time:
  │    Calculate reference baseline R_{r,c} = median_t(Flux_{t,r,c}) via Quickselect
  │  - Guard non-positive or non-finite pixel medians (fall back to safe zero)
  ▼
  ▼ [Footstep 3: 3D Grid Normalization]
  │  - Fractional flux change: P_{t,r,c} = (Flux_{t,r,c} / R_{r,c}) - 1.0
  │  - Flattened row-major pixel arrays with explicit grid dimensions
  │  - Pre-allocated Arrow Float32Builder & ListBuilder (avoids vector reallocations)
  ▼
  ▼ [Footstep 4: Spatial Drift & Centroid Dispersion Metrics]
  │  - In-place slice partitioning via split_at_mut (zero heap clone allocations)
  │  - Median Absolute Deviation (MAD): robust scatter in ppm (1.4826 * MAD * 10^6)
  │  - Reference temporal drift (half-1 median vs half-2 median) in ppm
  │  - Quantile extraction: P50 and P95 recorded in TargetPixelProcessingMetadata
  ▼
  ▼ [Footstep 5: Streaming Parquet Chunk Writer & In-Flight Hash]
  │  - Arrow Schema: `silver-target-pixel-v1` (time: Float64, quality: Int32, flux: List<Float32>, rows: Int32, cols: Int32)
  │  - TargetPixelStreamWriter appends Arrow row groups iteratively to disk
  │  - In-flight SHA-256 digest & byte tracker finalized on file close
  │  - Deterministic MinIO Object Key:
  │    silver/tess/target-pixel/processor=tpf-preprocess-v2-chunked/config={fp}/sector={s}/tic={tic}/{id}.parquet
```

#### Detailed Target Pixel Footsteps

1. **Footstep 1: Quality Masking & Cadence Indexing**
   - **Bounded Memory Ingress**: Opens the binary table via `TargetPixelChunkReader`. Instead of loading the entire 3D data cube into memory, cadences are streamed in configurable batches (`AURORA_TPF_CHUNK_CADENCES`, default 256).
   - **Cadence Validation**: Filters out cadences with missing or non-positive timestamps ($t \le 0$) or non-zero quality flags in `strict` quality mode.
   - **Index Preservation**: Retains cadence indices mapping directly to the primary aperture spatial grid.

2. **Footstep 2: Temporal Median Reference Level per Pixel**
   - **Pixel-Series Extraction**: For every spatial coordinate $(r, c)$ on the $H \times W$ grid, gathers the temporal flux series across all surviving cadences within the chunk.
   - **$O(n)$ In-Place Quickselect**: Determines the baseline stellar flux reference $R_{r,c} = \text{median}_t(F_{t,r,c})$ using `select_nth_unstable_by`.
   - **Degenerate Reference Handling**: If a pixel series has fewer than 2 valid observations, or if $R_{r,c} \le 0$ or non-finite, the pixel is marked invalid and assigned a neutral reference value to prevent division by zero or NaN propagation.

3. **Footstep 3: 3D Grid Normalization**
   - **Fractional Pixel Modulation**: Normalizes each finite pixel relative to its temporal baseline:
     $$P_{t,r,c} = \frac{F_{t,r,c}}{R_{r,c}} - 1.0$$
   - **Pre-Allocated Array Builders**: Uses Apache Arrow `Float32Builder::with_capacity(chunk_cadences * rows * cols)` and `ListBuilder::with_capacity(..., chunk_cadences)`. This eliminates dynamic heap reallocations when serializing large spatial cubes.
   - **Row-Major Layout**: Flattens the 2D grid per cadence in C-order (row-major) while embedding explicit `rows` and `cols` dimensions in the schema.

4. **Footstep 4: Spatial Drift & Centroid Stability Metrics**
   - **Zero-Copy Partitioning**: In-place `slice::split_at_mut(midpoint)` splits each pixel series into early and late epochs without heap `.to_vec()` clones (saving 242 heap allocations per 11x11 chunk).
   - **Robust Dispersion (MAD)**: Computes the Median Absolute Deviation (MAD) scaled to parts-per-million (ppm):
     $$\text{MAD}_{\text{ppm}} = 1.4826 \times \text{median}\left(\left|F_{t,r,c} - \text{median}(F_{r,c})\right|\right) \times 10^6$$
   - **Drift Estimation**: Computes the fractional drift between the early and late half medians:
     $$\Delta_{\text{drift}} = \frac{|\text{median}_1 - \text{median}_2|}{\text{median}_1} \times 10^6 \quad (\text{ppm})$$
   - **Centroid Metadata Extraction**: Computes $P_{50}$ (median) and $P_{95}$ across all spatial pixels for `pixel_scatter_mad_ppm`, `reference_drift_ppm`, and `boundary_jump_ppm`, recording them in `TargetPixelProcessingMetadata`.

5. **Footstep 5: Streaming Parquet Chunk Writer & In-Flight Hash**
   - **Multi-Row-Group Architecture**: `TargetPixelStreamWriter` flushes each bounded chunk as an independent Arrow Row Group directly into a local tempfile. Resident memory stays constant regardless of whether the TPF contains 1,000 or 50,000 cadences.
   - **In-Flight SHA-256 Digest**: `HashingWriter` intercepts every low-level byte written by the Parquet compression engine. Upon calling `.finish()`, size and digest are obtained immediately with zero disk re-read overhead.
   - **Deterministic Silver Key**: Emits a deterministic MinIO object path tagged by sector, TIC ID, processor version, and parameter configuration fingerprint.

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
