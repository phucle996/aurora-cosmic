use std::path::Path;

use anyhow::{bail, Context, Result};

use crate::config::{ImageConfig, LightCurveConfig};
use crate::event::{BronzeObjectReady, ProductKind};
use crate::failure::PipelineError;
use crate::fits::{self, DecodedProduct, TargetPixelChunkReader};
use crate::infra::MinioClient;
use crate::output::silver::{self, SilverArtifact};
use crate::pipeline;

/// Helper function to perform Steps 1..4 (Ingest, Decode, Preprocess, Serialize).
pub async fn execute_item_pipeline(
    minio: &MinioClient,
    event: &BronzeObjectReady,
    tmp_dir: &Path,
    lc_cfg: &LightCurveConfig,
    img_cfg: &ImageConfig,
    processing_fingerprint: &str,
) -> Result<SilverArtifact> {
    // Step 1: Ingest (Stat & Fetch)
    minio
        .stat_and_verify_size(&event.bucket, &event.object_key, event.size_bytes)
        .await?;

    let temp_fits_file = minio
        .fetch_to_temp(
            &event.bucket,
            &event.object_key,
            event.size_bytes,
            &event.sha256,
            tmp_dir,
        )
        .await?;

    // Steps 2, 3, 4: CPU-bound Decode -> Preprocess -> Parquet Serialization
    let event_clone = event.clone();
    let temp_fits_path = temp_fits_file.path.clone();
    let tmp_dir_clone = tmp_dir.to_path_buf();
    let lc_config = lc_cfg.clone();
    let img_config = img_cfg.clone();
    let fingerprint = processing_fingerprint.to_string();

    let artifact = tokio::task::spawn_blocking(move || -> Result<SilverArtifact> {
        if event_clone.product_kind == ProductKind::TargetPixel {
            return process_target_pixel_in_chunks(
                &temp_fits_path,
                &event_clone,
                &img_config,
                &tmp_dir_clone,
                &fingerprint,
            );
        }

        let decoded = fits::decode(&temp_fits_path, &event_clone).map_err(|error| {
            PipelineError::decode(format!(
                "FITS decode failed for {}: {error}",
                event_clone.object_key
            ))
        })?;
        match decoded {
            DecodedProduct::LightCurve(raw_lc) => {
                let processed =
                    pipeline::lightcurve::preprocess_lc(raw_lc, &event_clone, &lc_config)?;
                silver::serialize_lightcurve(&processed, &event_clone, &tmp_dir_clone, &fingerprint)
            }
            DecodedProduct::Ffi(raw_ffi) => {
                let processed =
                    pipeline::image::preprocess_ffi(raw_ffi, &event_clone, &img_config, None)?;
                silver::serialize_ffi(&processed, &event_clone, &tmp_dir_clone, &fingerprint)
            }
        }
    })
    .await
    .context("CPU task panicked")??;

    Ok(artifact)
}

/// Process one TPF in bounded cadence chunks. The input FITS stays on the
/// SSD-backed staging directory, while only one chunk and one Arrow row group
/// are resident in memory at a time.
fn process_target_pixel_in_chunks(
    fits_path: &Path,
    event: &BronzeObjectReady,
    config: &ImageConfig,
    tmp_dir: &Path,
    processing_fingerprint: &str,
) -> Result<SilverArtifact> {
    if config.tpf_normalization != "chunk-temporal-median" && config.tpf_normalization != "none" {
        bail!(
            "TPF '{}' requires AURORA_TPF_NORMALIZATION=chunk-temporal-median or none for bounded-memory processing; '{}' needs the full cube",
            event.object_key,
            config.tpf_normalization
        );
    }

    let mut reader = TargetPixelChunkReader::open(fits_path, event)?;
    let input_cadences = reader.total_cadences();
    let mut writer = silver::TargetPixelStreamWriter::new(tmp_dir)?;
    let mut chunk_count = 0usize;
    let mut output_cadences = 0usize;
    let mut quality_removed = 0usize;
    let mut invalid_time_removed = 0usize;
    let mut nonfinite_removed = 0usize;
    let mut nonpositive_time_removed = 0usize;
    let mut finite_pixels = 0f64;
    let mut inspected_pixels = 0usize;
    let mut input_pixel_values = 0usize;
    let mut normalized_pixel_values = 0usize;
    let mut nonfinite_pixel_values = 0usize;
    let mut invalid_reference_values = 0usize;
    let mut invalid_reference_pixels = 0usize;
    let mut pixel_scatter_p50 = Vec::new();
    let mut pixel_scatter_p95 = Vec::new();
    let mut reference_drift_p50 = Vec::new();
    let mut reference_drift_p95 = Vec::new();
    let mut boundary_jumps_ppm = Vec::new();
    let mut previous_last_frame: Option<Vec<f32>> = None;
    let mut tic_id = event.tic_id;

    while let Some(raw) = reader.next_chunk(config.tpf_chunk_cadences)? {
        let raw_cadences = raw.time.len();
        let rows = raw.rows;
        let cols = raw.cols;
        let mut chunk_quality_removed = 0usize;
        let mut chunk_invalid_time_removed = 0usize;
        let mut chunk_nonfinite_removed = 0usize;
        let mut chunk_nonpositive_time_removed = 0usize;
        for index in 0..raw_cadences {
            let time = raw.time[index];
            let quality = raw.quality.get(index).copied().unwrap_or(0);
            if config.tpf_quality_mode == "strict" && quality != 0 {
                chunk_quality_removed += 1;
            } else if !time.is_finite() {
                chunk_invalid_time_removed += 1;
                chunk_nonfinite_removed += 1;
            } else if time <= 0.0 {
                chunk_invalid_time_removed += 1;
                chunk_nonpositive_time_removed += 1;
            }
        }
        if tic_id.is_none() {
            tic_id = raw.tic_id;
        }

        match pipeline::image::preprocess_target_pixel(raw, event, config) {
            Ok(processed) => {
                output_cadences += processed.processing.output_cadences;
                quality_removed += processed.processing.quality_removed;
                invalid_time_removed += processed.processing.invalid_time_removed;
                nonfinite_removed += processed.processing.nonfinite_removed;
                nonpositive_time_removed += processed.processing.nonpositive_time_removed;
                let pixels_in_chunk = processed.processing.output_cadences * rows * cols;
                finite_pixels +=
                    processed.processing.finite_pixel_fraction as f64 * pixels_in_chunk as f64;
                inspected_pixels += pixels_in_chunk;
                input_pixel_values += processed.processing.input_pixel_values;
                normalized_pixel_values += processed.processing.normalized_pixel_values;
                nonfinite_pixel_values += processed.processing.nonfinite_pixel_values;
                invalid_reference_values += processed.processing.invalid_reference_values;
                invalid_reference_pixels += processed.processing.invalid_reference_pixels;
                pixel_scatter_p50.push(processed.processing.pixel_scatter_mad_p50_ppm);
                pixel_scatter_p95.push(processed.processing.pixel_scatter_mad_p95_ppm);
                reference_drift_p50.push(processed.processing.reference_drift_p50_ppm);
                reference_drift_p95.push(processed.processing.reference_drift_p95_ppm);
                if let Some(first_frame) = processed.flux.first() {
                    let current_first: Vec<f32> = first_frame.iter().flatten().copied().collect();
                    if let Some(previous) = &previous_last_frame {
                        let mut jumps: Vec<f32> = previous
                            .iter()
                            .zip(&current_first)
                            .filter_map(|(left, right)| {
                                if left.is_finite() && right.is_finite() {
                                    Some((right - left).abs() * 1_000_000.0)
                                } else {
                                    None
                                }
                            })
                            .collect();
                        jumps.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
                        if !jumps.is_empty() {
                            boundary_jumps_ppm.push(quantile_sorted(&jumps, 0.50));
                        }
                    }
                }
                previous_last_frame = processed
                    .flux
                    .last()
                    .map(|frame| frame.iter().flatten().copied().collect());
                writer.write_chunk(&processed)?;
                chunk_count += 1;
            }
            Err(error) if error.to_string().contains("Zero valid cadences remaining") => {
                // A strict-quality chunk may legitimately contain no usable
                // cadence. Count it and continue; the complete product only
                // fails if every chunk is empty.
                quality_removed += chunk_quality_removed;
                invalid_time_removed += chunk_invalid_time_removed;
                nonfinite_removed += chunk_nonfinite_removed;
                nonpositive_time_removed += chunk_nonpositive_time_removed;
                tracing::warn!(
                    object_key = %event.object_key,
                    chunk_cadences = raw_cadences,
                    operation = "tpf_preprocess_chunk",
                    status = "skipped_empty",
                    "TPF chunk had no valid cadences after filtering"
                );
            }
            Err(error) => return Err(error),
        }
    }

    if output_cadences == 0 {
        bail!(
            "Zero valid cadences remaining after quality filtering for TPF object {}",
            event.object_key
        );
    }

    let finite_pixel_fraction = if inspected_pixels == 0 {
        0.0
    } else {
        (finite_pixels / inspected_pixels as f64) as f32
    };
    let processing = pipeline::image::ImageProcessingMetadata {
        processor_version: if config.tpf_normalization == "chunk-temporal-median" {
            "tpf-preprocess-v2-chunked".to_string()
        } else {
            "tpf-preprocess-v2-streamed".to_string()
        },
        normalization_mode: config.tpf_normalization.clone(),
        input_cadences,
        output_cadences,
        quality_removed,
        invalid_time_removed,
        nonfinite_removed,
        nonpositive_time_removed,
        finite_pixel_fraction,
        input_pixel_values,
        normalized_pixel_values,
        nonfinite_pixel_values,
        invalid_reference_values,
        invalid_reference_pixels,
        pixel_scatter_mad_p50_ppm: quantile(&mut pixel_scatter_p50, 0.50),
        pixel_scatter_mad_p95_ppm: quantile(&mut pixel_scatter_p95, 0.95),
        reference_drift_p50_ppm: quantile(&mut reference_drift_p50, 0.50),
        reference_drift_p95_ppm: quantile(&mut reference_drift_p95, 0.95),
        boundary_jump_p50_ppm: quantile(&mut boundary_jumps_ppm, 0.50),
        boundary_jump_p95_ppm: quantile(&mut boundary_jumps_ppm, 0.95),
    };

    tracing::info!(
        object_key = %event.object_key,
        input_cadences,
        output_cadences,
        chunk_count,
        chunk_cadences = config.tpf_chunk_cadences,
        operation = "tpf_preprocess_stream",
        status = "processed",
        "TPF processed and serialized in bounded-memory chunks"
    );

    writer.finish(
        event,
        tic_id,
        processing,
        chunk_count,
        config.tpf_chunk_cadences,
        processing_fingerprint,
    )
}

fn quantile(values: &mut [f32], q: f32) -> f32 {
    values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    quantile_sorted(values, q)
}

fn quantile_sorted(values: &[f32], q: f32) -> f32 {
    if values.is_empty() {
        return 0.0;
    }
    let position = q * (values.len() - 1) as f32;
    let lower = position.floor() as usize;
    let upper = position.ceil() as usize;
    if lower == upper {
        values[lower]
    } else {
        values[lower] * (upper as f32 - position) + values[upper] * (position - lower as f32)
    }
}
