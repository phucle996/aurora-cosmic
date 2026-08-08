//! Gold Parquet reader. It keeps the conversion boundary explicit: identity
//! columns are preserved for prediction/audit while only manifest.feature_order
//! is sent to the model.

use anyhow::{Context, Result};
use arrow_array::{
    Array, BooleanArray, Float32Array, Float64Array, Int32Array, Int64Array, RecordBatch,
    StringArray,
};
use bytes::Bytes;
use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;
use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct GoldRow {
    pub raw_features: HashMap<String, Option<f64>>,
    pub source_product_id: String,
    pub sample_id: Option<String>,
    pub tic_id: i64,
    pub sector: i64,
}

fn column_index(batch: &RecordBatch, name: &str) -> Result<usize> {
    batch
        .schema()
        .index_of(name)
        .with_context(|| format!("Gold artifact is missing column '{name}'"))
}

fn numeric_value(array: &dyn Array, index: usize) -> Result<Option<f64>> {
    if array.is_null(index) {
        return Ok(None);
    }
    if let Some(values) = array.as_any().downcast_ref::<Float64Array>() {
        return Ok(Some(values.value(index)));
    }
    if let Some(values) = array.as_any().downcast_ref::<Float32Array>() {
        return Ok(Some(values.value(index) as f64));
    }
    if let Some(values) = array.as_any().downcast_ref::<Int64Array>() {
        return Ok(Some(values.value(index) as f64));
    }
    if let Some(values) = array.as_any().downcast_ref::<Int32Array>() {
        return Ok(Some(values.value(index) as f64));
    }
    if let Some(values) = array.as_any().downcast_ref::<BooleanArray>() {
        return Ok(Some(if values.value(index) { 1.0 } else { 0.0 }));
    }
    anyhow::bail!("unsupported numeric Gold column type at index {index}")
}

fn string_value(array: &dyn Array, index: usize) -> Result<Option<String>> {
    if array.is_null(index) {
        return Ok(None);
    }
    let values = array
        .as_any()
        .downcast_ref::<StringArray>()
        .context("Gold identity column is not UTF-8 string")?;
    Ok(Some(values.value(index).to_string()))
}

pub fn read_gold(bytes: Vec<u8>, feature_order: &[String]) -> Result<Vec<GoldRow>> {
    let builder = ParquetRecordBatchReaderBuilder::try_new(Bytes::from(bytes))
        .context("invalid Gold Parquet")?;
    let reader = builder
        .with_batch_size(1024)
        .build()
        .context("build Gold reader")?;
    let mut rows = Vec::new();
    for batch in reader {
        let batch = batch.context("read Gold record batch")?;
        let source_idx = column_index(&batch, "source_product_id")?;
        let tic_idx = column_index(&batch, "tic_id")?;
        let sector_idx = column_index(&batch, "sector")?;
        let sample_idx = batch.schema().index_of("sample_id").ok();
        let feature_indices = feature_order
            .iter()
            .map(|name| Ok((name.clone(), column_index(&batch, name)?)))
            .collect::<Result<Vec<_>>>()?;

        for row in 0..batch.num_rows() {
            let source = string_value(batch.column(source_idx).as_ref(), row)?
                .context("source_product_id cannot be null")?;
            let tic = numeric_value(batch.column(tic_idx).as_ref(), row)?
                .context("tic_id cannot be null")?;
            let sector = numeric_value(batch.column(sector_idx).as_ref(), row)?
                .context("sector cannot be null")?;
            let sample_id = sample_idx
                .map(|idx| string_value(batch.column(idx).as_ref(), row))
                .transpose()?
                .flatten();
            let mut raw_features = HashMap::with_capacity(feature_indices.len());
            for (name, idx) in &feature_indices {
                raw_features.insert(
                    name.clone(),
                    numeric_value(batch.column(*idx).as_ref(), row)?,
                );
            }
            rows.push(GoldRow {
                raw_features,
                source_product_id: source,
                sample_id,
                tic_id: tic as i64,
                sector: sector as i64,
            });
        }
    }
    if rows.is_empty() {
        anyhow::bail!("Gold artifact contains zero rows")
    }
    Ok(rows)
}
