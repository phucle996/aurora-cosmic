use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};

use crate::config::LightCurveConfig;
use crate::event::BronzeObjectReady;
use crate::fits::RawLightCurve;

/// Light Curve flux series source used for preprocessing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FluxSource {
    Pdcsap,
    Sap,
}

/// Quality filter policy.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QualityMode {
    Strict,
    None,
}

/// Preprocessing run metadata and statistics.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LightCurveProcessingMetadata {
    pub processor_version: String,
    pub flux_source: FluxSource,
    pub quality_mode: QualityMode,
    pub input_points: usize,
    pub output_points: usize,
    pub quality_removed: usize,
    pub invalid_removed: usize,
    pub outlier_removed: usize,
    pub flux_median: f32,
}

/// Normalized, cleaned Light Curve ready for downstream Silver encoding.
#[derive(Debug, Clone)]
pub struct ProcessedLightCurve {
    pub time: Vec<f64>,
    pub flux: Vec<f32>,
    pub flux_err: Option<Vec<f32>>,
    pub quality: Vec<i32>,

    pub tic_id: Option<u64>,
    pub sector: Option<u32>,
    pub camera: Option<u8>,
    pub ccd: Option<u8>,

    pub processing: LightCurveProcessingMetadata,
}

/// Preprocess a raw decoded Light Curve into a normalized, cleaned ProcessedLightCurve.
///
/// Pure CPU transformation function: no network/disk I/O.
pub fn preprocess_lc(
    raw: RawLightCurve,
    event: &BronzeObjectReady,
    cfg: &LightCurveConfig,
) -> Result<ProcessedLightCurve> {
    let input_points = raw.time.len();

    // 1. Select flux source (PDCSAP default, fallback to SAP if enabled)
    let (raw_flux, raw_flux_err, flux_source) = if let Some(pdc) = raw.pdcsap_flux {
        (pdc, raw.pdcsap_flux_err, FluxSource::Pdcsap)
    } else if cfg.allow_sap_fallback {
        if let Some(sap) = raw.sap_flux {
            (sap, raw.sap_flux_err, FluxSource::Sap)
        } else {
            bail!(
                "Missing required flux columns (both PDCSAP_FLUX and SAP_FLUX absent) for object {}",
                event.object_key
            );
        }
    } else {
        bail!(
            "PDCSAP_FLUX absent and SAP fallback disabled for object {}",
            event.object_key
        );
    };

    // Validate array length alignment
    if raw.time.len() != raw_flux.len() || raw.time.len() != raw.quality.len() {
        bail!(
            "Input array length mismatch for object {}: time={}, flux={}, quality={}",
            event.object_key,
            raw.time.len(),
            raw_flux.len(),
            raw.quality.len()
        );
    }
    if let Some(ref errs) = raw_flux_err {
        if errs.len() != raw.time.len() {
            bail!(
                "Flux error length mismatch for object {}: time={}, flux_err={}",
                event.object_key,
                raw.time.len(),
                errs.len()
            );
        }
    }

    if input_points < cfg.min_points {
        bail!(
            "Input points ({input_points}) below required minimum ({}) for object {}",
            cfg.min_points,
            event.object_key
        );
    }

    let quality_mode = if cfg.quality_mode == "strict" {
        QualityMode::Strict
    } else {
        QualityMode::None
    };

    // 2 & 3. Align and filter non-finite and quality values
    let mut invalid_removed = 0usize;
    let mut quality_removed = 0usize;

    let mut filtered_time = Vec::with_capacity(input_points);
    let mut filtered_flux = Vec::with_capacity(input_points);
    let mut filtered_err = raw_flux_err
        .as_ref()
        .map(|_| Vec::with_capacity(input_points));
    let mut filtered_qual = Vec::with_capacity(input_points);

    for i in 0..input_points {
        let t = raw.time[i];
        let f = raw_flux[i];
        let q = raw.quality[i];
        let err_valid = match raw_flux_err {
            Some(ref errs) => errs[i].is_finite(),
            None => true,
        };

        // Non-finite filter
        if !t.is_finite() || !f.is_finite() || !err_valid {
            invalid_removed += 1;
            continue;
        }

        // Quality filter (strict mode requires quality == 0)
        if quality_mode == QualityMode::Strict && q != 0 {
            quality_removed += 1;
            continue;
        }

        filtered_time.push(t);
        filtered_flux.push(f);
        if let (Some(ref mut err_vec), Some(ref errs)) = (&mut filtered_err, &raw_flux_err) {
            err_vec.push(errs[i]);
        }
        filtered_qual.push(q);
    }

    let post_filter_points = filtered_time.len();
    if post_filter_points < cfg.min_points {
        bail!(
            "Post-filter points ({post_filter_points}) below required minimum ({}) for object {}",
            cfg.min_points,
            event.object_key
        );
    }

    // 4. Ensure TIME is ascending & remove duplicate timestamps deterministically
    let mut indices: Vec<usize> = (0..post_filter_points).collect();
    indices.sort_by(|&a, &b| {
        filtered_time[a]
            .partial_cmp(&filtered_time[b])
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let mut sorted_time = Vec::with_capacity(post_filter_points);
    let mut sorted_flux = Vec::with_capacity(post_filter_points);
    let mut sorted_err = filtered_err
        .as_ref()
        .map(|_| Vec::with_capacity(post_filter_points));
    let mut sorted_qual = Vec::with_capacity(post_filter_points);

    let mut last_t: Option<f64> = None;
    for idx in indices {
        let t = filtered_time[idx];
        // Deduplicate: keep first occurrence of identical timestamp
        if let Some(prev) = last_t {
            if (t - prev).abs() < 1e-9 {
                continue;
            }
        }
        last_t = Some(t);

        sorted_time.push(t);
        sorted_flux.push(filtered_flux[idx]);
        if let (Some(ref mut s_err), Some(ref f_err)) = (&mut sorted_err, &filtered_err) {
            s_err.push(f_err[idx]);
        }
        sorted_qual.push(filtered_qual[idx]);
    }

    let sorted_points = sorted_time.len();
    if sorted_points < cfg.min_points {
        bail!(
            "Points after deduplication ({sorted_points}) below required minimum ({}) for object {}",
            cfg.min_points,
            event.object_key
        );
    }

    // 5. Calculate Median & Normalize
    let flux_median = calculate_median(&sorted_flux);
    if !flux_median.is_finite() || flux_median <= 0.0 {
        bail!(
            "Invalid non-positive or non-finite flux median ({flux_median}) for object {}",
            event.object_key
        );
    }

    let mut norm_flux: Vec<f32> = sorted_flux
        .iter()
        .map(|&f| (f / flux_median) - 1.0)
        .collect();

    let mut norm_err: Option<Vec<f32>> =
        sorted_err.map(|errs| errs.iter().map(|&e| e / flux_median).collect());

    // 6. Optional conservative sigma clipping
    let mut outlier_removed = 0usize;
    if let Some(sigma) = cfg.sigma_clip {
        if sigma > 0.0 && norm_flux.len() > 10 {
            let std_dev = calculate_std_dev(&norm_flux);
            let threshold = (sigma as f32) * std_dev;
            let mut clip_indices = Vec::new();
            for (i, &f) in norm_flux.iter().enumerate() {
                if f.abs() > threshold {
                    clip_indices.push(i);
                }
            }
            if !clip_indices.is_empty() {
                outlier_removed = clip_indices.len();
                let keep_mask: Vec<bool> = (0..norm_flux.len())
                    .map(|i| !clip_indices.contains(&i))
                    .collect();

                sorted_time = sorted_time
                    .into_iter()
                    .enumerate()
                    .filter(|(i, _)| keep_mask[*i])
                    .map(|(_, v)| v)
                    .collect();
                norm_flux = norm_flux
                    .into_iter()
                    .enumerate()
                    .filter(|(i, _)| keep_mask[*i])
                    .map(|(_, v)| v)
                    .collect();
                if let Some(errs) = norm_err {
                    norm_err = Some(
                        errs.into_iter()
                            .enumerate()
                            .filter(|(i, _)| keep_mask[*i])
                            .map(|(_, v)| v)
                            .collect(),
                    );
                }
                sorted_qual = sorted_qual
                    .into_iter()
                    .enumerate()
                    .filter(|(i, _)| keep_mask[*i])
                    .map(|(_, v)| v)
                    .collect();
            }
        }
    }

    let output_points = sorted_time.len();

    tracing::info!(
        object_key = %event.object_key,
        input_points = input_points,
        output_points = output_points,
        quality_removed = quality_removed,
        invalid_removed = invalid_removed,
        outlier_removed = outlier_removed,
        flux_median = flux_median,
        flux_source = ?flux_source,
        operation = "lightcurve_preprocess",
        status = "processed",
        "Light Curve preprocessed successfully"
    );

    Ok(ProcessedLightCurve {
        time: sorted_time,
        flux: norm_flux,
        flux_err: norm_err,
        quality: sorted_qual,
        tic_id: raw.tic_id.or(event.tic_id),
        sector: raw.sector.or(Some(event.sector)),
        camera: raw.camera.or(event.camera),
        ccd: raw.ccd.or(event.ccd),
        processing: LightCurveProcessingMetadata {
            processor_version: "lc-preprocess-v1".to_string(),
            flux_source,
            quality_mode,
            input_points,
            output_points,
            quality_removed,
            invalid_removed,
            outlier_removed,
            flux_median,
        },
    })
}

/// Helper: compute median of f32 slice.
#[allow(clippy::manual_is_multiple_of)]
fn calculate_median(values: &[f32]) -> f32 {
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

/// Helper: compute sample standard deviation of f32 slice.
fn calculate_std_dev(values: &[f32]) -> f32 {
    if values.len() < 2 {
        return 0.0;
    }
    let mean = values.iter().sum::<f32>() / (values.len() as f32);
    let variance = values
        .iter()
        .map(|v| {
            let diff = v - mean;
            diff * diff
        })
        .sum::<f32>()
        / ((values.len() - 1) as f32);
    variance.sqrt()
}
