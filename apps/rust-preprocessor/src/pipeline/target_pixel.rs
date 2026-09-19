use anyhow::Result;
use serde::{Deserialize, Serialize};

use crate::config::ImageConfig;
use crate::event::BronzeObjectReady;
use crate::failure::PipelineError;
use crate::fits::RawTargetPixel;

/// Processing metadata embedded in output artifact definitions.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TargetPixelProcessingMetadata {
    pub processor_version: String,
    pub normalization_mode: String,
    pub input_cadences: usize,
    pub output_cadences: usize,
    pub quality_removed: usize,
    pub invalid_time_removed: usize,
    #[serde(default)]
    pub nonfinite_removed: usize,
    #[serde(default)]
    pub nonpositive_time_removed: usize,
    pub finite_pixel_fraction: f32,
    #[serde(default)]
    pub input_pixel_values: usize,
    #[serde(default)]
    pub normalized_pixel_values: usize,
    #[serde(default)]
    pub nonfinite_pixel_values: usize,
    #[serde(default)]
    pub invalid_reference_values: usize,
    #[serde(default)]
    pub invalid_reference_pixels: usize,
    #[serde(default)]
    pub pixel_scatter_mad_p50_ppm: f32,
    #[serde(default)]
    pub pixel_scatter_mad_p95_ppm: f32,
    #[serde(default)]
    pub reference_drift_p50_ppm: f32,
    #[serde(default)]
    pub reference_drift_p95_ppm: f32,
    #[serde(default)]
    pub boundary_jump_p50_ppm: f32,
    #[serde(default)]
    pub boundary_jump_p95_ppm: f32,
}

/// Normalized, cleaned Target Pixel File data structure.
#[derive(Debug, Clone)]
pub struct ProcessedTargetPixel {
    pub time: Vec<f64>,
    pub quality: Vec<i32>,
    pub flux: Vec<Vec<Vec<f32>>>, // [cadence][row][col]
    pub rows: usize,
    pub cols: usize,
    pub processing: TargetPixelProcessingMetadata,
}

/// Preprocess a raw Target Pixel File into a ProcessedTargetPixel.
#[allow(clippy::needless_range_loop)]
pub fn preprocess_target_pixel(
    raw: RawTargetPixel,
    event: &BronzeObjectReady,
    config: &ImageConfig,
) -> Result<ProcessedTargetPixel> {
    let input_cadences = raw.time.len();
    if input_cadences == 0 || raw.rows == 0 || raw.cols == 0 {
        return Err(PipelineError::rejected(format!(
            "Raw Target Pixel File contains zero cadences or empty grid for object {}",
            event.object_key
        ))
        .into());
    }

    // 1. Quality & Non-finite Time Filtering
    let mut retained_indices = Vec::with_capacity(input_cadences);
    let mut quality_removed = 0usize;
    let mut invalid_time_removed = 0usize;
    let mut nonfinite_removed = 0usize;
    let mut nonpositive_time_removed = 0usize;

    for i in 0..input_cadences {
        let t = raw.time[i];
        let q = raw.quality.get(i).copied().unwrap_or(0);

        if config.tpf_quality_mode == "strict" && q != 0 {
            quality_removed += 1;
            continue;
        }

        if !t.is_finite() {
            invalid_time_removed += 1;
            nonfinite_removed += 1;
            continue;
        }
        if t <= 0.0 {
            invalid_time_removed += 1;
            nonpositive_time_removed += 1;
            continue;
        }

        retained_indices.push(i);
    }

    let output_cadences = retained_indices.len();
    if output_cadences == 0 {
        return Err(PipelineError::rejected(format!(
            "Zero valid cadences remaining after quality filtering for TPF object {}",
            event.object_key
        ))
        .into());
    }

    let filtered_time: Vec<f64> = retained_indices.iter().map(|&i| raw.time[i]).collect();
    let filtered_quality: Vec<i32> = retained_indices
        .iter()
        .map(|&i| raw.quality.get(i).copied().unwrap_or(0))
        .collect();

    // 2. Compute reference median per pixel position across retained cadences
    let mut pixel_medians = vec![vec![0.0f32; raw.cols]; raw.rows];
    let mut global_pixels = if config.tpf_normalization == "global-median" {
        Some(Vec::new())
    } else {
        None
    };
    let mut total_pixels = 0usize;
    let mut finite_count = 0usize;
    let mut reference_drifts_ppm = Vec::with_capacity(raw.rows * raw.cols);

    for r in 0..raw.rows {
        for c in 0..raw.cols {
            let mut pixel_series = Vec::with_capacity(output_cadences);
            for &cad_idx in &retained_indices {
                if cad_idx < raw.flux.len()
                    && r < raw.flux[cad_idx].len()
                    && c < raw.flux[cad_idx][r].len()
                {
                    let p = raw.flux[cad_idx][r][c];
                    total_pixels += 1;
                    if p.is_finite() {
                        finite_count += 1;
                        pixel_series.push(p);
                        if let Some(ref mut values) = global_pixels {
                            values.push(p);
                        }
                    }
                }
            }

            pixel_medians[r][c] = if !pixel_series.is_empty() {
                let midpoint = pixel_series.len() / 2;
                if midpoint > 0 {
                    let (first_half, second_half) = pixel_series.split_at_mut(midpoint);
                    let first = median_f32(first_half);
                    let second = median_f32(second_half);
                    let reference = median_f32(&mut pixel_series);
                    if first.is_finite()
                        && second.is_finite()
                        && reference.is_finite()
                        && reference.abs() > f32::EPSILON
                    {
                        reference_drifts_ppm
                            .push(((second - first).abs() / reference.abs()) * 1_000_000.0);
                    }
                    reference
                } else {
                    median_f32(&mut pixel_series)
                }
            } else {
                0.0
            };
        }
    }

    let global_median = global_pixels
        .as_mut()
        .map(|values| median_f32(values))
        .unwrap_or(0.0);
    let invalid_reference_pixels = match config.tpf_normalization.as_str() {
        "none" => 0,
        "global-median" if !global_median.is_finite() || global_median <= 0.0 => {
            raw.rows * raw.cols
        }
        "global-median" => 0,
        _ => pixel_medians
            .iter()
            .flatten()
            .filter(|value| !value.is_finite() || **value <= 0.0)
            .count(),
    };

    // 3. Normalize per-pixel temporal flux
    let mut norm_flux = Vec::with_capacity(output_cadences);
    let mut normalized_pixel_values = 0usize;
    let mut nonfinite_pixel_values = 0usize;
    let mut invalid_reference_values = 0usize;
    for &cad_idx in &retained_indices {
        let mut frame = Vec::with_capacity(raw.rows);
        for r in 0..raw.rows {
            let mut row_pixels = Vec::with_capacity(raw.cols);
            for c in 0..raw.cols {
                let p = if cad_idx < raw.flux.len()
                    && r < raw.flux[cad_idx].len()
                    && c < raw.flux[cad_idx][r].len()
                {
                    raw.flux[cad_idx][r][c]
                } else {
                    0.0
                };

                let reference = match config.tpf_normalization.as_str() {
                    "global-median" => global_median,
                    "temporal-median" | "chunk-temporal-median" => pixel_medians[r][c],
                    "none" => 1.0,
                    _ => unreachable!("normalization mode validated during config loading"),
                };
                let norm = if !p.is_finite() {
                    nonfinite_pixel_values += 1;
                    0.0
                } else if config.tpf_normalization == "none" {
                    normalized_pixel_values += 1;
                    p
                } else if reference.is_finite() && reference > 0.0 {
                    normalized_pixel_values += 1;
                    (p / reference) - 1.0
                } else {
                    invalid_reference_values += 1;
                    // Safe handling for invalid/zero reference: preserve neutral baseline
                    0.0
                };
                row_pixels.push(norm);
            }
            frame.push(row_pixels);
        }
        norm_flux.push(frame);
    }

    let finite_pixel_fraction = if total_pixels > 0 {
        finite_count as f32 / total_pixels as f32
    } else {
        0.0
    };
    let mut pixel_scatter_mad_ppm = Vec::with_capacity(raw.rows * raw.cols);
    for r in 0..raw.rows {
        for c in 0..raw.cols {
            let reference_valid = config.tpf_normalization == "none"
                || match config.tpf_normalization.as_str() {
                    "global-median" => global_median.is_finite() && global_median > 0.0,
                    _ => pixel_medians[r][c].is_finite() && pixel_medians[r][c] > 0.0,
                };
            if !reference_valid {
                continue;
            }
            let mut series: Vec<f32> = norm_flux
                .iter()
                .map(|frame| frame[r][c])
                .filter(|value| value.is_finite())
                .collect();
            if series.len() >= 2 {
                pixel_scatter_mad_ppm.push(robust_mad(&mut series) * 1_000_000.0);
            }
        }
    }
    pixel_scatter_mad_ppm.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    reference_drifts_ppm.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

    tracing::info!(
        object_key = %event.object_key,
        input_cadences = input_cadences,
        output_cadences = output_cadences,
        quality_removed = quality_removed,
        invalid_time_removed = invalid_time_removed,
        nonfinite_removed = nonfinite_removed,
        nonpositive_time_removed = nonpositive_time_removed,
        rows = raw.rows,
        cols = raw.cols,
        operation = "tpf_preprocess",
        status = "processed",
        "TPF image preprocessed successfully"
    );

    Ok(ProcessedTargetPixel {
        time: filtered_time,
        quality: filtered_quality,
        flux: norm_flux,
        rows: raw.rows,
        cols: raw.cols,
        processing: TargetPixelProcessingMetadata {
            processor_version: if config.tpf_normalization == "chunk-temporal-median" {
                "tpf-preprocess-v2-chunked".to_string()
            } else {
                "tpf-preprocess-v1".to_string()
            },
            normalization_mode: config.tpf_normalization.clone(),
            input_cadences,
            output_cadences,
            quality_removed,
            invalid_time_removed,
            nonfinite_removed,
            nonpositive_time_removed,
            finite_pixel_fraction,
            input_pixel_values: total_pixels,
            normalized_pixel_values,
            nonfinite_pixel_values,
            invalid_reference_values,
            invalid_reference_pixels,
            pixel_scatter_mad_p50_ppm: quantile_sorted_f32(&pixel_scatter_mad_ppm, 0.50),
            pixel_scatter_mad_p95_ppm: quantile_sorted_f32(&pixel_scatter_mad_ppm, 0.95),
            reference_drift_p50_ppm: quantile_sorted_f32(&reference_drifts_ppm, 0.50),
            reference_drift_p95_ppm: quantile_sorted_f32(&reference_drifts_ppm, 0.95),
            boundary_jump_p50_ppm: 0.0,
            boundary_jump_p95_ppm: 0.0,
        },
    })
}

fn median_f32(values: &mut [f32]) -> f32 {
    if values.is_empty() {
        return 0.0;
    }
    let mid = values.len() / 2;
    values.select_nth_unstable_by(mid, |a, b| {
        a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal)
    });
    if values.len().is_multiple_of(2) {
        let val_mid = values[mid];
        let max_left = values[..mid]
            .iter()
            .max_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
            .copied()
            .unwrap_or(val_mid);
        (max_left + val_mid) / 2.0
    } else {
        values[mid]
    }
}

fn robust_mad(values: &mut [f32]) -> f32 {
    let median = median_f32(values);
    let mut deviations: Vec<f32> = values.iter().map(|value| (value - median).abs()).collect();
    1.4826 * median_f32(&mut deviations)
}

fn quantile_sorted_f32(values: &[f32], q: f32) -> f32 {
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

