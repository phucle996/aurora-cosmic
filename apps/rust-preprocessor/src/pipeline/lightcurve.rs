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
    pub processing: LightCurveProcessingMetadata,
}

/// Preprocess a raw decoded Light Curve into a normalized, cleaned ProcessedLightCurve.
pub fn preprocess_lc(
    raw: RawLightCurve,
    event: &BronzeObjectReady,
    cfg: &LightCurveConfig,
) -> Result<ProcessedLightCurve> {
    let input_points = raw.time.len();
    if input_points == 0 {
        bail!(
            "Raw Light Curve contains zero points for object {}",
            event.object_key
        );
    }

    // 1. Determine Flux Source (PDCSAP vs SAP Fallback)
    let (flux_source, raw_flux, raw_err) = if let Some(pdcsap) = raw.pdcsap_flux {
        (FluxSource::Pdcsap, pdcsap, raw.pdcsap_flux_err)
    } else if cfg.allow_sap_fallback {
        if let Some(sap) = raw.sap_flux {
            (FluxSource::Sap, sap, raw.sap_flux_err)
        } else {
            bail!(
                "Both PDCSAP_FLUX and SAP_FLUX are missing for object {}",
                event.object_key
            );
        }
    } else {
        bail!(
            "PDCSAP_FLUX is missing and allow_sap_fallback=false for object {}",
            event.object_key
        );
    };

    // 2. Select Quality Filter Mode
    let quality_mode = if cfg.quality_mode == "strict" {
        QualityMode::Strict
    } else {
        QualityMode::None
    };

    // 3. Filter points by Quality Flag & Non-finite values
    let mut filtered_time = Vec::with_capacity(input_points);
    let mut filtered_flux = Vec::with_capacity(input_points);
    let mut filtered_err = raw_err
        .as_ref()
        .map(|_| Vec::with_capacity(input_points));
    let mut filtered_qual = Vec::with_capacity(input_points);

    let mut quality_removed = 0usize;
    let mut invalid_removed = 0usize;

    for i in 0..input_points {
        let t = raw.time[i];
        let f = raw_flux[i];
        let q = raw.quality.get(i).copied().unwrap_or(0);

        // Quality check
        if quality_mode == QualityMode::Strict && q != 0 {
            quality_removed += 1;
            continue;
        }

        // Finite / non-zero time & flux check
        if !t.is_finite() || t <= 0.0 || !f.is_finite() {
            invalid_removed += 1;
            continue;
        }

        filtered_time.push(t);
        filtered_flux.push(f);
        if let (Some(ref mut f_err_vec), Some(ref r_err_vec)) = (&mut filtered_err, &raw_err) {
            f_err_vec.push(r_err_vec.get(i).copied().unwrap_or(0.0));
        }
        filtered_qual.push(q);
    }

    let post_filter_points = filtered_time.len();
    if post_filter_points < cfg.min_points {
        bail!(
            "Points after quality/invalid filtering ({post_filter_points}) below required minimum ({}) for object {}",
            cfg.min_points,
            event.object_key
        );
    }

    // 4. Time-ordering check & deduplication
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

/// Calculate the median of a slice of f32 values.
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

/// Calculate standard deviation of a slice of f32 values.
fn calculate_std_dev(values: &[f32]) -> f32 {
    if values.is_empty() {
        return 0.0;
    }
    let sum: f32 = values.iter().sum();
    let mean = sum / values.len() as f32;
    let variance: f32 = values.iter().map(|&x| (x - mean).powi(2)).sum::<f32>() / values.len() as f32;
    variance.sqrt()
}
