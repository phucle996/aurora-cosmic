use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};

use crate::config::ImageConfig;
use crate::event::BronzeObjectReady;
use crate::fits::{RawFfi, RawTargetPixel};

/// Processing metadata embedded in output artifact definitions.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageProcessingMetadata {
    pub processor_version: String,
    pub normalization_mode: String,
    pub input_cadences: usize,
    pub output_cadences: usize,
    pub quality_removed: usize,
    pub invalid_time_removed: usize,
    pub finite_pixel_fraction: f32,
}

/// Statistics calculated over valid (finite) image pixels.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ImageStatistics {
    pub width: usize,
    pub height: usize,
    pub finite_pixel_count: usize,
    pub finite_pixel_fraction: f32,
    pub median: f32,
    pub mean: f32,
    pub stddev: f32,
    pub min: f32,
    pub max: f32,
}

/// Extracted image sub-region cutout data.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ImageCutout {
    pub x: usize,
    pub y: usize,
    pub width: usize,
    pub height: usize,
    pub pixels: Vec<f32>,
}

/// Normalized, cleaned Target Pixel File data structure.
#[derive(Debug, Clone)]
pub struct ProcessedTargetPixel {
    pub time: Vec<f64>,
    pub quality: Vec<i32>,
    pub flux: Vec<Vec<Vec<f32>>>, // [cadence][row][col]
    pub rows: usize,
    pub cols: usize,
    pub tic_id: Option<u64>,
    pub processing: ImageProcessingMetadata,
}

/// Normalized, calibrated Full Frame Image representation with statistics and cutouts.
#[derive(Debug, Clone)]
pub struct ProcessedFfi {
    pub width: usize,
    pub height: usize,
    pub statistics: ImageStatistics,
    pub cutouts: Vec<ImageCutout>,
    pub processing: ImageProcessingMetadata,
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
        bail!(
            "Raw Target Pixel File contains zero cadences or empty grid for object {}",
            event.object_key
        );
    }

    // 1. Quality & Non-finite Time Filtering
    let mut retained_indices = Vec::with_capacity(input_cadences);
    let mut quality_removed = 0usize;
    let mut invalid_time_removed = 0usize;

    for i in 0..input_cadences {
        let t = raw.time[i];
        let q = raw.quality.get(i).copied().unwrap_or(0);

        if !t.is_finite() || t <= 0.0 {
            invalid_time_removed += 1;
            continue;
        }

        if config.tpf_quality_mode == "strict" && q != 0 {
            quality_removed += 1;
            continue;
        }

        retained_indices.push(i);
    }

    let output_cadences = retained_indices.len();
    if output_cadences == 0 {
        bail!(
            "Zero valid cadences remaining after quality filtering for TPF object {}",
            event.object_key
        );
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
                median_f32(&mut pixel_series)
            } else {
                0.0
            };
        }
    }

    let global_median = global_pixels
        .as_mut()
        .map(|values| median_f32(values))
        .unwrap_or(0.0);

    // 3. Normalize per-pixel temporal flux
    let mut norm_flux = Vec::with_capacity(output_cadences);
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
                    "temporal-median" => pixel_medians[r][c],
                    "none" => 1.0,
                    _ => unreachable!("normalization mode validated during config loading"),
                };
                let norm = if !p.is_finite() {
                    0.0
                } else if config.tpf_normalization == "none" {
                    p
                } else if reference.is_finite() && reference > 0.0 {
                    (p / reference) - 1.0
                } else {
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

    tracing::info!(
        object_key = %event.object_key,
        input_cadences = input_cadences,
        output_cadences = output_cadences,
        quality_removed = quality_removed,
        invalid_time_removed = invalid_time_removed,
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
        tic_id: raw.tic_id.or(event.tic_id),
        processing: ImageProcessingMetadata {
            processor_version: "tpf-preprocess-v1".to_string(),
            normalization_mode: config.tpf_normalization.clone(),
            input_cadences,
            output_cadences,
            quality_removed,
            invalid_time_removed,
            finite_pixel_fraction,
        },
    })
}

fn median_f32(values: &mut [f32]) -> f32 {
    if values.is_empty() {
        return 0.0;
    }
    values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let mid = values.len() / 2;
    if values.len() % 2 == 0 {
        (values[mid - 1] + values[mid]) / 2.0
    } else {
        values[mid]
    }
}

/// Preprocess a raw Full Frame Image into ProcessedFfi containing statistics and optional cutouts.
pub fn preprocess_ffi(
    raw: RawFfi,
    event: &BronzeObjectReady,
    config: &ImageConfig,
    cutout_rects: Option<&[(usize, usize, usize, usize)]>,
) -> Result<ProcessedFfi> {
    if raw.width == 0 || raw.height == 0 || raw.pixels.is_empty() {
        bail!(
            "Raw FFI contains empty pixel grid for object {}",
            event.object_key
        );
    }

    // 1. Calculate Image Statistics over finite pixels
    let mut finite_pixels: Vec<f32> = raw
        .pixels
        .iter()
        .copied()
        .filter(|p| p.is_finite())
        .collect();

    let total_pixels = raw.pixels.len();
    let finite_pixel_count = finite_pixels.len();
    let finite_pixel_fraction = if total_pixels > 0 {
        finite_pixel_count as f32 / total_pixels as f32
    } else {
        0.0
    };

    let statistics = if finite_pixel_count > 0 {
        finite_pixels.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let mid = finite_pixel_count / 2;
        let median = if finite_pixel_count % 2 == 0 {
            (finite_pixels[mid - 1] + finite_pixels[mid]) / 2.0
        } else {
            finite_pixels[mid]
        };

        let sum: f64 = finite_pixels.iter().map(|&p| p as f64).sum();
        let mean = (sum / finite_pixel_count as f64) as f32;

        let variance_sum: f64 = finite_pixels
            .iter()
            .map(|&p| {
                let diff = p as f64 - mean as f64;
                diff * diff
            })
            .sum();
        let stddev = ((variance_sum / finite_pixel_count as f64).sqrt()) as f32;

        let min = finite_pixels[0];
        let max = finite_pixels[finite_pixel_count - 1];

        ImageStatistics {
            width: raw.width,
            height: raw.height,
            finite_pixel_count,
            finite_pixel_fraction,
            median,
            mean,
            stddev,
            min,
            max,
        }
    } else {
        ImageStatistics {
            width: raw.width,
            height: raw.height,
            finite_pixel_count: 0,
            finite_pixel_fraction: 0.0,
            median: 0.0,
            mean: 0.0,
            stddev: 0.0,
            min: 0.0,
            max: 0.0,
        }
    };

    // 2. Optional Bounded Cutout Extraction
    let mut cutouts = Vec::new();
    if let Some(rects) = cutout_rects {
        for &(x, y, w, h) in rects {
            if x + w > raw.width || y + h > raw.height {
                bail!(
                    "Cutout rect out of bounds for object {}: rect=({x},{y},{w},{h}) vs FFI=({}x{})",
                    event.object_key,
                    raw.width,
                    raw.height
                );
            }
            let mut cutout_pixels = Vec::with_capacity(w * h);
            for row in y..y + h {
                let row_offset = row * raw.width + x;
                cutout_pixels.extend_from_slice(&raw.pixels[row_offset..row_offset + w]);
            }
            cutouts.push(ImageCutout {
                x,
                y,
                width: w,
                height: h,
                pixels: cutout_pixels,
            });
        }
    }

    tracing::info!(
        object_key = %event.object_key,
        width = raw.width,
        height = raw.height,
        finite_pixels = statistics.finite_pixel_count,
        cutouts = cutouts.len(),
        operation = "ffi_preprocess",
        status = "processed",
        "FFI image preprocessed successfully"
    );

    Ok(ProcessedFfi {
        width: raw.width,
        height: raw.height,
        statistics,
        cutouts,
        processing: ImageProcessingMetadata {
            processor_version: "ffi-preprocess-v1".to_string(),
            normalization_mode: config.ffi_normalization.clone(),
            input_cadences: 1,
            output_cadences: 1,
            quality_removed: 0,
            invalid_time_removed: 0,
            finite_pixel_fraction,
        },
    })
}
