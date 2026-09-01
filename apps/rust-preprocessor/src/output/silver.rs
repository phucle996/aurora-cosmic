use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;

use anyhow::{Context, Result};
use arrow::array::{
    ArrayRef, Float32Array, Float32Builder, Float64Array, Int32Array, Int64Array, ListBuilder,
    RecordBatch,
};
use arrow::datatypes::{DataType, Field, Schema};

use parquet::arrow::arrow_writer::ArrowWriter;
use parquet::basic::Compression;
use parquet::file::properties::WriterProperties;

use sha2::{Digest, Sha256};
use tempfile::NamedTempFile;

use crate::event::BronzeObjectReady;
use crate::pipeline::image::{ImageProcessingMetadata, ProcessedFfi, ProcessedTargetPixel};
use crate::pipeline::lightcurve::ProcessedLightCurve;

/// Metadata and local file handle of a serialized Silver Parquet artifact.
#[derive(Debug)]
pub struct SilverArtifact {
    pub bucket: String,
    pub object_key: String,
    pub schema_version: String,
    pub processor_version: String,
    pub local_path: PathBuf,
    pub size_bytes: u64,
    pub sha256: String,
    pub metadata: HashMap<String, String>,
    // Keeps NamedTempFile handle alive until upload completes
    _handle: NamedTempFile,
}

/// Incremental Parquet writer for a TPF. Every written chunk becomes an Arrow
/// record batch / Parquet row group, so the complete pixel cube is never held
/// in memory.
pub struct TargetPixelStreamWriter {
    schema: Arc<Schema>,
    writer: ArrowWriter<File>,
    temp_file: NamedTempFile,
    rows: Option<usize>,
    cols: Option<usize>,
    output_cadences: usize,
}

impl TargetPixelStreamWriter {
    pub fn new(tmp_dir: &Path) -> Result<Self> {
        let schema = target_pixel_schema();
        let temp_file = NamedTempFile::new_in(tmp_dir)
            .context("Failed to create temporary TPF Parquet file")?;
        let file = File::create(temp_file.path())
            .context("Failed to open temporary TPF Parquet file for writing")?;
        let props = WriterProperties::builder()
            .set_compression(Compression::ZSTD(Default::default()))
            .build();
        let writer = ArrowWriter::try_new(file, schema.clone(), Some(props))
            .context("Failed to create streaming TPF Parquet writer")?;

        Ok(Self {
            schema,
            writer,
            temp_file,
            rows: None,
            cols: None,
            output_cadences: 0,
        })
    }

    pub fn write_chunk(&mut self, tpf: &ProcessedTargetPixel) -> Result<()> {
        if tpf.time.is_empty() {
            return Ok(());
        }
        if let (Some(rows), Some(cols)) = (self.rows, self.cols) {
            if rows != tpf.rows || cols != tpf.cols {
                anyhow::bail!(
                    "TPF chunk grid changed while streaming: expected {}x{}, got {}x{}",
                    rows,
                    cols,
                    tpf.rows,
                    tpf.cols
                );
            }
        } else {
            self.rows = Some(tpf.rows);
            self.cols = Some(tpf.cols);
        }

        let batch = target_pixel_batch(self.schema.clone(), tpf)?;
        self.writer
            .write(&batch)
            .context("Failed to append TPF chunk to Parquet writer")?;
        self.output_cadences += tpf.time.len();
        Ok(())
    }

    pub fn finish(
        self,
        event: &BronzeObjectReady,
        tic_id: Option<u64>,
        processing: ImageProcessingMetadata,
        chunk_count: usize,
        chunk_cadences: usize,
        processing_fingerprint: &str,
    ) -> Result<SilverArtifact> {
        if self.output_cadences == 0 {
            anyhow::bail!("Cannot finalize an empty streamed TPF artifact");
        }

        self.writer
            .close()
            .context("Failed to finalize streaming TPF Parquet writer")?;

        let local_path = self.temp_file.path().to_path_buf();
        let (size_bytes, sha256) = file_size_and_sha256(&local_path)?;
        let schema_version = "silver-target-pixel-v1".to_string();
        let processor_version = processing.processor_version.clone();
        let object_key = build_tpf_key(
            event.sector,
            tic_id,
            &event.source_product_id,
            &processor_version,
            processing_fingerprint,
        );

        let mut metadata =
            target_pixel_metadata(event, &schema_version, &processor_version, &sha256, tic_id);
        metadata.insert(
            "normalization-mode".to_string(),
            processing.normalization_mode,
        );
        metadata.insert(
            "input-cadences".to_string(),
            processing.input_cadences.to_string(),
        );
        metadata.insert(
            "output-cadences".to_string(),
            processing.output_cadences.to_string(),
        );
        metadata.insert(
            "quality-removed".to_string(),
            processing.quality_removed.to_string(),
        );
        metadata.insert(
            "invalid-time-removed".to_string(),
            processing.invalid_time_removed.to_string(),
        );
        metadata.insert(
            "nonfinite-removed".to_string(),
            processing.nonfinite_removed.to_string(),
        );
        metadata.insert(
            "nonpositive-time-removed".to_string(),
            processing.nonpositive_time_removed.to_string(),
        );
        metadata.insert(
            "finite-pixel-fraction".to_string(),
            processing.finite_pixel_fraction.to_string(),
        );
        for (key, value) in [
            (
                "tpf-input-pixel-values",
                processing.input_pixel_values.to_string(),
            ),
            (
                "tpf-normalized-pixel-values",
                processing.normalized_pixel_values.to_string(),
            ),
            (
                "tpf-nonfinite-pixel-values",
                processing.nonfinite_pixel_values.to_string(),
            ),
            (
                "tpf-invalid-reference-values",
                processing.invalid_reference_values.to_string(),
            ),
            (
                "tpf-invalid-reference-pixels",
                processing.invalid_reference_pixels.to_string(),
            ),
            (
                "tpf-pixel-scatter-mad-p50-ppm",
                processing.pixel_scatter_mad_p50_ppm.to_string(),
            ),
            (
                "tpf-pixel-scatter-mad-p95-ppm",
                processing.pixel_scatter_mad_p95_ppm.to_string(),
            ),
            (
                "tpf-reference-drift-p50-ppm",
                processing.reference_drift_p50_ppm.to_string(),
            ),
            (
                "tpf-reference-drift-p95-ppm",
                processing.reference_drift_p95_ppm.to_string(),
            ),
            (
                "tpf-boundary-jump-p50-ppm",
                processing.boundary_jump_p50_ppm.to_string(),
            ),
            (
                "tpf-boundary-jump-p95-ppm",
                processing.boundary_jump_p95_ppm.to_string(),
            ),
        ] {
            metadata.insert(key.to_string(), value);
        }
        metadata.insert("tpf-chunk-count".to_string(), chunk_count.to_string());
        metadata.insert("tpf-chunk-cadences".to_string(), chunk_cadences.to_string());
        metadata.insert(
            "processing-fingerprint".to_string(),
            processing_fingerprint.to_string(),
        );

        Ok(SilverArtifact {
            bucket: event.bucket.clone(),
            object_key,
            schema_version,
            processor_version,
            local_path,
            size_bytes,
            sha256,
            metadata,
            _handle: self.temp_file,
        })
    }
}

/// Build deterministic Silver MinIO object key for Light Curve.
pub fn build_lc_key(
    sector: u32,
    tic_id: Option<u64>,
    source_product_id: &str,
    processor_version: &str,
    processing_fingerprint: &str,
) -> String {
    let tic_str = tic_id
        .map(|t| t.to_string())
        .unwrap_or_else(|| "none".to_string());
    format!(
        "silver/tess/lightcurve/processor={processor_version}/config={processing_fingerprint}/sector={sector:04}/tic={tic_str}/{source_product_id}.parquet"
    )
}

/// Build deterministic Silver MinIO object key for Target Pixel File (TPF).
pub fn build_tpf_key(
    sector: u32,
    tic_id: Option<u64>,
    source_product_id: &str,
    processor_version: &str,
    processing_fingerprint: &str,
) -> String {
    let tic_str = tic_id
        .map(|t| t.to_string())
        .unwrap_or_else(|| "none".to_string());
    format!(
        "silver/tess/target-pixel/processor={processor_version}/config={processing_fingerprint}/sector={sector:04}/tic={tic_str}/{source_product_id}.parquet"
    )
}

/// Build deterministic Silver MinIO object key for Full Frame Image (FFI).
pub fn build_ffi_key(
    sector: u32,
    camera: Option<u8>,
    ccd: Option<u8>,
    source_product_id: &str,
    processor_version: &str,
    processing_fingerprint: &str,
) -> String {
    let cam_str = camera
        .map(|c| c.to_string())
        .unwrap_or_else(|| "none".to_string());
    let ccd_str = ccd
        .map(|c| c.to_string())
        .unwrap_or_else(|| "none".to_string());
    format!(
        "silver/tess/ffi/processor={processor_version}/config={processing_fingerprint}/sector={sector:04}/camera={cam_str}/ccd={ccd_str}/{source_product_id}.parquet"
    )
}

/// Serialize a ProcessedLightCurve to a Parquet file with Arrow schema `silver-lightcurve-v1` and ZSTD compression.
pub fn serialize_lightcurve(
    lc: &ProcessedLightCurve,
    event: &BronzeObjectReady,
    tmp_dir: &Path,
    processing_fingerprint: &str,
) -> Result<SilverArtifact> {
    let schema_version = "silver-lightcurve-v1".to_string();
    let processor_version = lc.processing.processor_version.clone();
    let object_key = build_lc_key(
        event.sector,
        lc.tic_id,
        &event.source_product_id,
        &processor_version,
        processing_fingerprint,
    );

    let schema = Arc::new(Schema::new(vec![
        Field::new("time", DataType::Float64, false),
        Field::new("flux", DataType::Float32, false),
        Field::new("flux_err", DataType::Float32, true),
        Field::new("quality", DataType::Int32, false),
    ]));

    let time_array = Arc::new(Float64Array::from(lc.time.clone())) as ArrayRef;
    let flux_array = Arc::new(Float32Array::from(lc.flux.clone())) as ArrayRef;
    let flux_err_array: ArrayRef = match &lc.flux_err {
        Some(errs) => Arc::new(Float32Array::from(
            errs.iter().map(|&e| Some(e)).collect::<Vec<_>>(),
        )),
        None => Arc::new(Float32Array::from(vec![None::<f32>; lc.time.len()])),
    };
    let quality_array = Arc::new(Int32Array::from(lc.quality.clone())) as ArrayRef;

    let batch = RecordBatch::try_new(
        schema.clone(),
        vec![time_array, flux_array, flux_err_array, quality_array],
    )
    .context("Failed to create Light Curve Arrow RecordBatch")?;

    let encode_started = Instant::now();
    let (local_path, size_bytes, sha256, handle) = write_parquet_batch(schema, batch, tmp_dir)?;
    let encode_duration_ms = encode_started.elapsed().as_secs_f64() * 1_000.0;

    let mut metadata = HashMap::new();
    metadata.insert("schema-version".to_string(), schema_version.clone());
    metadata.insert("processor-version".to_string(), processor_version.clone());
    metadata.insert(
        "source-product-id".to_string(),
        event.source_product_id.clone(),
    );
    metadata.insert("bronze-object-key".to_string(), event.object_key.clone());
    metadata.insert("bronze-sha256".to_string(), event.sha256.clone());
    metadata.insert("silver-sha256".to_string(), sha256.clone());
    metadata.insert("product-kind".to_string(), "LIGHT_CURVE".to_string());
    metadata.insert(
        "parquet-encode-duration-ms".to_string(),
        encode_duration_ms.to_string(),
    );
    if let Some(tic) = lc.tic_id {
        metadata.insert("tic-id".to_string(), tic.to_string());
    }
    metadata.insert("sector".to_string(), event.sector.to_string());
    metadata.insert(
        "processing-fingerprint".to_string(),
        processing_fingerprint.to_string(),
    );
    metadata.insert(
        "input-points".to_string(),
        lc.processing.input_points.to_string(),
    );
    metadata.insert(
        "output-points".to_string(),
        lc.processing.output_points.to_string(),
    );
    metadata.insert(
        "quality-removed".to_string(),
        lc.processing.quality_removed.to_string(),
    );
    metadata.insert(
        "invalid-removed".to_string(),
        lc.processing.invalid_removed.to_string(),
    );
    metadata.insert(
        "nonfinite-removed".to_string(),
        lc.processing.nonfinite_removed.to_string(),
    );
    metadata.insert(
        "nonpositive-time-removed".to_string(),
        lc.processing.nonpositive_time_removed.to_string(),
    );
    metadata.insert(
        "outlier-removed".to_string(),
        lc.processing.outlier_removed.to_string(),
    );
    metadata.insert(
        "sigma-clip-3-4-removed".to_string(),
        lc.processing.sigma_clip_3_4_removed.to_string(),
    );
    metadata.insert(
        "sigma-clip-4-5-removed".to_string(),
        lc.processing.sigma_clip_4_5_removed.to_string(),
    );
    metadata.insert(
        "sigma-clip-ge-5-removed".to_string(),
        lc.processing.sigma_clip_ge_5_removed.to_string(),
    );
    metadata.insert(
        "normalized-scatter-before-clip-ppm".to_string(),
        lc.processing.normalized_scatter_before_clip_ppm.to_string(),
    );
    metadata.insert(
        "normalized-scatter-after-clip-ppm".to_string(),
        lc.processing.normalized_scatter_after_clip_ppm.to_string(),
    );
    if let Some(level) = lc.processing.sigma_clip_level {
        metadata.insert("sigma-clip-level".to_string(), level.to_string());
    }
    metadata.insert(
        "flux-median".to_string(),
        lc.processing.flux_median.to_string(),
    );

    Ok(SilverArtifact {
        bucket: event.bucket.clone(),
        object_key,
        schema_version,
        processor_version,
        local_path,
        size_bytes,
        sha256,
        metadata,
        _handle: handle,
    })
}

fn target_pixel_schema() -> Arc<Schema> {
    Arc::new(Schema::new(vec![
        Field::new("time", DataType::Float64, false),
        Field::new("quality", DataType::Int32, false),
        Field::new(
            "flux",
            DataType::List(Arc::new(Field::new("item", DataType::Float32, true))),
            false,
        ),
        Field::new("rows", DataType::Int32, false),
        Field::new("cols", DataType::Int32, false),
    ]))
}

fn target_pixel_batch(schema: Arc<Schema>, tpf: &ProcessedTargetPixel) -> Result<RecordBatch> {
    let time_array = Arc::new(Float64Array::from(tpf.time.clone())) as ArrayRef;
    let quality_array = Arc::new(Int32Array::from(tpf.quality.clone())) as ArrayRef;
    let mut flux_builder = ListBuilder::new(Float32Builder::new());

    for cadence in &tpf.flux {
        for row in cadence {
            for &pixel in row {
                flux_builder.values().append_value(pixel);
            }
        }
        flux_builder.append(true);
    }
    let flux_list_array = Arc::new(flux_builder.finish()) as ArrayRef;
    let rows_array = Arc::new(Int32Array::from(vec![tpf.rows as i32; tpf.time.len()])) as ArrayRef;
    let cols_array = Arc::new(Int32Array::from(vec![tpf.cols as i32; tpf.time.len()])) as ArrayRef;

    RecordBatch::try_new(
        schema,
        vec![
            time_array,
            quality_array,
            flux_list_array,
            rows_array,
            cols_array,
        ],
    )
    .context("Failed to create TPF Arrow RecordBatch")
}

fn target_pixel_metadata(
    event: &BronzeObjectReady,
    schema_version: &str,
    processor_version: &str,
    sha256: &str,
    tic_id: Option<u64>,
) -> HashMap<String, String> {
    let mut metadata = HashMap::new();
    metadata.insert("schema-version".to_string(), schema_version.to_string());
    metadata.insert(
        "processor-version".to_string(),
        processor_version.to_string(),
    );
    metadata.insert(
        "source-product-id".to_string(),
        event.source_product_id.clone(),
    );
    metadata.insert("bronze-object-key".to_string(), event.object_key.clone());
    metadata.insert("bronze-sha256".to_string(), event.sha256.clone());
    metadata.insert("silver-sha256".to_string(), sha256.to_string());
    metadata.insert("product-kind".to_string(), "TARGET_PIXEL".to_string());
    metadata.insert("sector".to_string(), event.sector.to_string());
    if let Some(tic) = tic_id {
        metadata.insert("tic-id".to_string(), tic.to_string());
    }
    metadata
}

/// Serialize a ProcessedFfi to a Parquet file with Arrow schema `silver-ffi-v1` and ZSTD compression.
pub fn serialize_ffi(
    ffi: &ProcessedFfi,
    event: &BronzeObjectReady,
    tmp_dir: &Path,
    processing_fingerprint: &str,
) -> Result<SilverArtifact> {
    let schema_version = "silver-ffi-v1".to_string();
    let processor_version = ffi.processing.processor_version.clone();
    let object_key = build_ffi_key(
        event.sector,
        event.camera,
        event.ccd,
        &event.source_product_id,
        &processor_version,
        processing_fingerprint,
    );

    let schema = Arc::new(Schema::new(vec![
        Field::new("width", DataType::Int32, false),
        Field::new("height", DataType::Int32, false),
        Field::new("finite_pixel_count", DataType::Int64, false),
        Field::new("finite_pixel_fraction", DataType::Float32, false),
        Field::new("median", DataType::Float32, false),
        Field::new("mean", DataType::Float32, false),
        Field::new("stddev", DataType::Float32, false),
        Field::new("min", DataType::Float32, false),
        Field::new("max", DataType::Float32, false),
    ]));

    let s = &ffi.statistics;
    let batch = RecordBatch::try_new(
        schema.clone(),
        vec![
            Arc::new(Int32Array::from(vec![s.width as i32])) as ArrayRef,
            Arc::new(Int32Array::from(vec![s.height as i32])) as ArrayRef,
            Arc::new(Int64Array::from(vec![s.finite_pixel_count as i64])) as ArrayRef,
            Arc::new(Float32Array::from(vec![s.finite_pixel_fraction])) as ArrayRef,
            Arc::new(Float32Array::from(vec![s.median])) as ArrayRef,
            Arc::new(Float32Array::from(vec![s.mean])) as ArrayRef,
            Arc::new(Float32Array::from(vec![s.stddev])) as ArrayRef,
            Arc::new(Float32Array::from(vec![s.min])) as ArrayRef,
            Arc::new(Float32Array::from(vec![s.max])) as ArrayRef,
        ],
    )
    .context("Failed to create FFI Arrow RecordBatch")?;

    let (local_path, size_bytes, sha256, handle) = write_parquet_batch(schema, batch, tmp_dir)?;

    let mut metadata = HashMap::new();
    metadata.insert("schema-version".to_string(), schema_version.clone());
    metadata.insert("processor-version".to_string(), processor_version.clone());
    metadata.insert(
        "source-product-id".to_string(),
        event.source_product_id.clone(),
    );
    metadata.insert("bronze-object-key".to_string(), event.object_key.clone());
    metadata.insert("bronze-sha256".to_string(), event.sha256.clone());
    metadata.insert(
        "processing-fingerprint".to_string(),
        processing_fingerprint.to_string(),
    );
    metadata.insert("silver-sha256".to_string(), sha256.clone());
    metadata.insert("product-kind".to_string(), "FFI".to_string());

    Ok(SilverArtifact {
        bucket: event.bucket.clone(),
        object_key,
        schema_version,
        processor_version,
        local_path,
        size_bytes,
        sha256,
        metadata,
        _handle: handle,
    })
}

/// Helper: Write Arrow RecordBatch to local Parquet file with ZSTD compression and return path, size, sha256, temp handle.
fn write_parquet_batch(
    schema: Arc<Schema>,
    batch: RecordBatch,
    tmp_dir: &Path,
) -> Result<(PathBuf, u64, String, NamedTempFile)> {
    let temp_file =
        NamedTempFile::new_in(tmp_dir).context("Failed to create temporary Parquet file")?;
    let path = temp_file.path().to_path_buf();

    let file = File::create(&path).context("Failed to open temp Parquet file for writing")?;

    let props = WriterProperties::builder()
        .set_compression(Compression::ZSTD(Default::default()))
        .build();

    let mut writer = ArrowWriter::try_new(file, schema, Some(props))
        .context("Failed to create Parquet ArrowWriter")?;

    writer
        .write(&batch)
        .context("Failed to write RecordBatch to Parquet writer")?;
    writer
        .close()
        .context("Failed to finalize Parquet file writer")?;

    let (size_bytes, sha256) = file_size_and_sha256(&path)?;

    Ok((path, size_bytes, sha256, temp_file))
}

/// Hash output incrementally so a multi-GB Parquet artifact is never copied
/// into RAM merely to calculate its integrity metadata.
fn file_size_and_sha256(path: &Path) -> Result<(u64, String)> {
    let mut file = File::open(path).context("Failed to open Parquet file for hashing")?;
    let mut hasher = Sha256::new();
    let mut size_bytes = 0u64;
    let mut buffer = [0u8; 1024 * 1024];

    loop {
        let read = file
            .read(&mut buffer)
            .context("Failed to read Parquet file for hashing")?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        size_bytes += read as u64;
    }

    Ok((size_bytes, hex::encode(hasher.finalize())))
}
