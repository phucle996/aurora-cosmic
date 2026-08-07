use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};

use crate::config::ImageConfig;
use crate::event::BronzeObjectReady;
use crate::fits::{RawFfi, RawTargetPixel};

/// Processing metadata for TPF and FFI image pipeline runs.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageProcessingMetadata {
    pub processor_version: String,
    pub normalization_mode: String,
    pub input_cadences: usize,
    pub output_cadences: usize,
    pub quality_removed: usize,
    pub invalid_time_removed: usize,
    pub rows: usize,
    pub cols: usize,
    pub finite_pixel_fraction: f32,
}

/// Finite-aware image statistics.
#[derive(Debug, Clone, Serialize, Deserialize)]
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

/// Extracted 2D image cutout.
#[derive(Debug, Clone, Serialize, Deserialize)]
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
    pub flux_err: Option<Vec<Vec<Vec<f32>>>>,
    pub rows: usize,
    pub cols: usize,
    pub tic_id: Option<u64>,
    pub sector: Option<u32>,
    pub processing: ImageProcessingMetadata,
}

/// Normalized, calibrated Full Frame Image representation with statistics and cutouts.
#[derive(Debug, Clone)]
pub struct ProcessedFfi {
    pub width: usize,
    pub height: usize,
    pub statistics: ImageStatistics,
    pub cutouts: Vec<ImageCutout>,
    pub sector: Option<u32>,
    pub camera: Option<u8>,
    pub ccd: Option<u8>,
    pub processing: ImageProcessingMetadata,
}

/// Preprocess a raw Target Pixel File into a ProcessedTargetPixel.
pub fn preprocess_target_pixel(
    raw: RawTargetPixel,
    event: &BronzeObjectReady,
    config: &ImageConfig,
) -> Result<ProcessedTargetPixel> {
    let input_cadences = raw.time.len();
    if input_cadences != raw.quality.len() {
        bail!(
            "Cadence alignment mismatch for object {}: time len={} vs quality len={}",
            event.object_key,
            input_cadences,
            raw.quality.len()
        );
    }
    if raw.rows == 0 || raw.cols == 0 {
        bail!(
            "Invalid TPF dimensions for object {}: rows={}, cols={}",
            event.object_key,
            raw.rows,
            raw.cols
        );
    }

    // 1. Cadence-level Quality and Invalid TIME filtering
    let mut invalid_time_removed = 0usize;
    let mut quality_removed = 0usize;

    let mut retained_indices = Vec::with_capacity(input_cadences);
    for i in 0..input_cadences {
        if !raw.time[i].is_finite() {
            invalid_time_removed += 1;
            continue;
        }
        if config.tpf_quality_mode == "strict" && raw.quality[i] != 0 {
            quality_removed += 1;
            continue;
        }
        retained_indices.push(i);
    }

    let output_cadences = retained_indices.len();
    if output_cadences == 0 {
        bail!(
            "All TPF cadences removed during filtering for object {}",
            event.object_key
        );
    }

    let filtered_time: Vec<f64> = retained_indices.iter().map(|&i| raw.time[i]).collect();
    let filtered_quality: Vec<i32> = retained_indices.iter().map(|&i| raw.quality[i]).collect();

    // 2. Per-Pixel Temporal Median Reference Calculation
    // For each (r, c), find median across all retained cadences
    let mut pixel_medians = vec![vec![0.0f32; raw.cols]; raw.rows];
    let mut finite_count = 0usize;
    let total_pixels = output_cadences * raw.rows * raw.cols;

    for r in 0..raw.rows {
        for c in 0..raw.cols {
            let mut cadence_vals = Vec::with_capacity(output_cadences);
            for &cad_idx in &retained_indices {
                if cad_idx < raw.flux.len()
                    && r < raw.flux[cad_idx].len()
                    && c < raw.flux[cad_idx][r].len()
                {
                    let val = raw.flux[cad_idx][r][c];
                    if val.is_finite() {
                        cadence_vals.push(val);
                        finite_count += 1;
                    }
                }
            }
            if !cadence_vals.is_empty() {
                pixel_medians[r][c] = calculate_f32_median(&cadence_vals);
            }
        }
    }

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

                let ref_med = pixel_medians[r][c];
                let norm = if p.is_finite() && ref_med.is_finite() && ref_med > 0.0 {
                    (p / ref_med) - 1.0
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
        flux_err: None, // Optional flux_err normalization reserved for future V2
        rows: raw.rows,
        cols: raw.cols,
        tic_id: raw.tic_id.or(event.tic_id),
        sector: raw.sector.or(Some(event.sector)),
        processing: ImageProcessingMetadata {
            processor_version: "tpf-preprocess-v1".to_string(),
            normalization_mode: config.tpf_normalization.clone(),
            input_cadences,
            output_cadences,
            quality_removed,
            invalid_time_removed,
            rows: raw.rows,
            cols: raw.cols,
            finite_pixel_fraction,
        },
    })
}

/// Preprocess a raw Full Frame Image into a ProcessedFfi with finite-aware statistics and optional cutouts.
pub fn preprocess_ffi(
    raw: RawFfi,
    event: &BronzeObjectReady,
    config: &ImageConfig,
    cutout_rects: Option<&[(usize, usize, usize, usize)]>, // (x, y, w, h)
) -> Result<ProcessedFfi> {
    if raw.width == 0 || raw.height == 0 {
        bail!(
            "Invalid FFI dimensions for object {}: width={}, height={}",
            event.object_key,
            raw.width,
            raw.height
        );
    }
    let expected_len = raw.width * raw.height;
    if raw.pixels.len() != expected_len {
        bail!(
            "FFI pixel buffer length mismatch for object {}: expected={}, actual={}",
            event.object_key,
            expected_len,
            raw.pixels.len()
        );
    }

    // 1. Calculate Finite-Aware Image Statistics
    let finite_pixels: Vec<f32> = raw
        .pixels
        .iter()
        .copied()
        .filter(|p| p.is_finite())
        .collect();

    let finite_pixel_count = finite_pixels.len();
    let finite_pixel_fraction = if expected_len > 0 {
        finite_pixel_count as f32 / expected_len as f32
    } else {
        0.0
    };

    let statistics = if !finite_pixels.is_empty() {
        let min = finite_pixels.iter().copied().fold(f32::INFINITY, f32::min);
        let max = finite_pixels.iter().copied().fold(f32::NEG_INFINITY, f32::max);
        let sum: f64 = finite_pixels.iter().map(|&p| p as f64).sum();
        let mean = (sum / finite_pixel_count as f64) as f32;

        let var_sum: f64 = finite_pixels
            .iter()
            .map(|&p| {
                let diff = (p as f64) - (mean as f64);
                diff * diff
            })
            .sum();
        let stddev = if finite_pixel_count > 1 {
            ((var_sum / (finite_pixel_count - 1) as f64).sqrt()) as f32
        } else {
            0.0
        };

        let median = calculate_f32_median(&finite_pixels);

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
        sector: raw.sector.or(Some(event.sector)),
        camera: raw.camera.or(event.camera),
        ccd: raw.ccd.or(event.ccd),
        processing: ImageProcessingMetadata {
            processor_version: "ffi-preprocess-v1".to_string(),
            normalization_mode: config.ffi_normalization.clone(),
            input_cadences: 1,
            output_cadences: 1,
            quality_removed: 0,
            invalid_time_removed: 0,
            rows: raw.height,
            cols: raw.width,
            finite_pixel_fraction,
        },
    })
}

/// Helper to calculate median of f32 slice.
fn calculate_f32_median(values: &[f32]) -> f32 {
    if values.is_empty() {
        return 0.0;
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let mid = sorted.len() / 2;
    if sorted.len() % 2 == 0 {
        (sorted[mid - 1] + sorted[mid]) / 2.0
    } else {
        sorted[mid]
    }
}
