use std::collections::HashMap;
use std::fs::File;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{Context, Result};
use arrow::array::{
    ArrayRef, Float32Array, Float32Builder, Float64Array, Int32Array, Int64Array,
    ListBuilder, RecordBatch,
};
use arrow::datatypes::{DataType, Field, Schema};

use parquet::arrow::arrow_writer::ArrowWriter;
use parquet::basic::Compression;
use parquet::file::properties::WriterProperties;

use sha2::{Digest, Sha256};
use tempfile::NamedTempFile;

use crate::event::BronzeObjectReady;
use crate::pipeline::image::{ProcessedFfi, ProcessedTargetPixel};
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

/// Build deterministic Silver MinIO object key for Light Curve.
pub fn build_lc_key(
    sector: u32,
    tic_id: Option<u64>,
    source_product_id: &str,
    processor_version: &str,
) -> String {
    let tic_str = tic_id.map(|t| t.to_string()).unwrap_or_else(|| "none".to_string());
    format!(
        "silver/tess/lightcurve/processor={processor_version}/sector={sector:04}/tic={tic_str}/{source_product_id}.parquet"
    )
}

/// Build deterministic Silver MinIO object key for Target Pixel File (TPF).
pub fn build_tpf_key(
    sector: u32,
    tic_id: Option<u64>,
    source_product_id: &str,
    processor_version: &str,
) -> String {
    let tic_str = tic_id.map(|t| t.to_string()).unwrap_or_else(|| "none".to_string());
    format!(
        "silver/tess/target-pixel/processor={processor_version}/sector={sector:04}/tic={tic_str}/{source_product_id}.parquet"
    )
}

/// Build deterministic Silver MinIO object key for Full Frame Image (FFI).
pub fn build_ffi_key(
    sector: u32,
    camera: Option<u8>,
    ccd: Option<u8>,
    source_product_id: &str,
    processor_version: &str,
) -> String {
    let cam_str = camera.map(|c| c.to_string()).unwrap_or_else(|| "none".to_string());
    let ccd_str = ccd.map(|c| c.to_string()).unwrap_or_else(|| "none".to_string());
    format!(
        "silver/tess/ffi/processor={processor_version}/sector={sector:04}/camera={cam_str}/ccd={ccd_str}/{source_product_id}.parquet"
    )
}

/// Serialize a ProcessedLightCurve to a Parquet file with Arrow schema `silver-lightcurve-v1` and ZSTD compression.
pub fn serialize_lightcurve(
    lc: &ProcessedLightCurve,
    event: &BronzeObjectReady,
    tmp_dir: &Path,
) -> Result<SilverArtifact> {
    let schema_version = "silver-lightcurve-v1".to_string();
    let processor_version = lc.processing.processor_version.clone();
    let object_key = build_lc_key(event.sector, lc.tic_id, &event.source_product_id, &processor_version);

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

    let (local_path, size_bytes, sha256, handle) = write_parquet_batch(schema, batch, tmp_dir)?;

    let mut metadata = HashMap::new();
    metadata.insert("schema-version".to_string(), schema_version.clone());
    metadata.insert("processor-version".to_string(), processor_version.clone());
    metadata.insert("source-product-id".to_string(), event.source_product_id.clone());
    metadata.insert("bronze-object-key".to_string(), event.object_key.clone());
    metadata.insert("bronze-sha256".to_string(), event.sha256.clone());
    metadata.insert("silver-sha256".to_string(), sha256.clone());
    metadata.insert("product-kind".to_string(), "LIGHT_CURVE".to_string());
    if let Some(tic) = lc.tic_id {
        metadata.insert("tic-id".to_string(), tic.to_string());
    }
    metadata.insert("sector".to_string(), event.sector.to_string());

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

/// Serialize a ProcessedTargetPixel to a Parquet file with Arrow schema `silver-target-pixel-v1` and ZSTD compression.
pub fn serialize_target_pixel(
    tpf: &ProcessedTargetPixel,
    event: &BronzeObjectReady,
    tmp_dir: &Path,
) -> Result<SilverArtifact> {
    let schema_version = "silver-target-pixel-v1".to_string();
    let processor_version = tpf.processing.processor_version.clone();
    let object_key = build_tpf_key(event.sector, tpf.tic_id, &event.source_product_id, &processor_version);

    let schema = Arc::new(Schema::new(vec![
        Field::new("time", DataType::Float64, false),
        Field::new("quality", DataType::Int32, false),
        Field::new(
            "flux",
            DataType::List(Arc::new(Field::new("item", DataType::Float32, true))),
            false,
        ),
        Field::new("rows", DataType::Int32, false),
        Field::new("cols", DataType::Int32, false),
    ]));

    let time_array = Arc::new(Float64Array::from(tpf.time.clone())) as ArrayRef;
    let quality_array = Arc::new(Int32Array::from(tpf.quality.clone())) as ArrayRef;

    // Flatten 3D flux [cadence][row][col] to Arrow List<Float32> (row-major)
    let values_builder = Float32Builder::new();
    let mut flux_builder = ListBuilder::new(values_builder);

    for cadence in &tpf.flux {
        for row in cadence {
            for &pixel in row {
                flux_builder.values().append_value(pixel);
            }
        }
        flux_builder.append(true);
    }
    let flux_list_array = Arc::new(flux_builder.finish()) as ArrayRef;

    let rows_vec = vec![tpf.rows as i32; tpf.time.len()];
    let cols_vec = vec![tpf.cols as i32; tpf.time.len()];
    let rows_array = Arc::new(Int32Array::from(rows_vec)) as ArrayRef;
    let cols_array = Arc::new(Int32Array::from(cols_vec)) as ArrayRef;

    let batch = RecordBatch::try_new(
        schema.clone(),
        vec![time_array, quality_array, flux_list_array, rows_array, cols_array],
    )
    .context("Failed to create TPF Arrow RecordBatch")?;

    let (local_path, size_bytes, sha256, handle) = write_parquet_batch(schema, batch, tmp_dir)?;

    let mut metadata = HashMap::new();
    metadata.insert("schema-version".to_string(), schema_version.clone());
    metadata.insert("processor-version".to_string(), processor_version.clone());
    metadata.insert("source-product-id".to_string(), event.source_product_id.clone());
    metadata.insert("bronze-object-key".to_string(), event.object_key.clone());
    metadata.insert("bronze-sha256".to_string(), event.sha256.clone());
    metadata.insert("silver-sha256".to_string(), sha256.clone());
    metadata.insert("product-kind".to_string(), "TARGET_PIXEL".to_string());

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

/// Serialize a ProcessedFfi to a Parquet file with Arrow schema `silver-ffi-v1` and ZSTD compression.
pub fn serialize_ffi(
    ffi: &ProcessedFfi,
    event: &BronzeObjectReady,
    tmp_dir: &Path,
) -> Result<SilverArtifact> {
    let schema_version = "silver-ffi-v1".to_string();
    let processor_version = ffi.processing.processor_version.clone();
    let object_key = build_ffi_key(
        event.sector,
        ffi.camera,
        ffi.ccd,
        &event.source_product_id,
        &processor_version,
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
    metadata.insert("source-product-id".to_string(), event.source_product_id.clone());
    metadata.insert("bronze-object-key".to_string(), event.object_key.clone());
    metadata.insert("bronze-sha256".to_string(), event.sha256.clone());
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
    let temp_file = NamedTempFile::new_in(tmp_dir)
        .context("Failed to create temporary Parquet file")?;
    let path = temp_file.path().to_path_buf();

    let file = File::create(&path).context("Failed to open temp Parquet file for writing")?;

    let props = WriterProperties::builder()
        .set_compression(Compression::ZSTD(Default::default()))
        .build();

    let mut writer = ArrowWriter::try_new(file, schema, Some(props))
        .context("Failed to create Parquet ArrowWriter")?;

    writer.write(&batch).context("Failed to write RecordBatch to Parquet writer")?;
    writer.close().context("Failed to finalize Parquet file writer")?;

    // Read back file to get size and calculate SHA-256
    let bytes = std::fs::read(&path).context("Failed to read back Parquet file for hashing")?;
    let size_bytes = bytes.len() as u64;
    let sha256 = hex::encode(Sha256::digest(&bytes));

    Ok((path, size_bytes, sha256, temp_file))
}
