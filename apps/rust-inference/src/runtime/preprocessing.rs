use std::collections::HashMap;

use super::error::RuntimeError;
use crate::domain::model::PreprocessingConfig;

/// Preprocess raw feature dictionary into standardized float32 vector.
pub fn preprocess_features(
    raw_features: &HashMap<String, Option<f64>>,
    feature_order: &[String],
    config: &PreprocessingConfig,
) -> Result<Vec<f32>, RuntimeError> {
    let mut standardized = Vec::with_capacity(feature_order.len());

    for feat in feature_order {
        let raw_opt = raw_features
            .get(feat)
            .ok_or_else(|| RuntimeError::MissingFeature(feat.clone()))?;

        let val = match raw_opt {
            Some(v) => {
                if v.is_nan() || v.is_infinite() {
                    return Err(RuntimeError::Integrity(format!(
                        "Non-finite float value encountered for feature '{feat}': {v}"
                    )));
                }
                *v
            }
            None => *config.feature_medians.get(feat).ok_or_else(|| {
                RuntimeError::InvalidPackage(format!(
                    "missing median for nullable feature '{feat}'"
                ))
            })?,
        };

        let mean = *config.feature_means.get(feat).ok_or_else(|| {
            RuntimeError::InvalidPackage(format!("missing mean for feature '{feat}'"))
        })?;
        let scale = *config.feature_scales.get(feat).ok_or_else(|| {
            RuntimeError::InvalidPackage(format!("missing scale for feature '{feat}'"))
        })?;
        if !mean.is_finite() || !scale.is_finite() || scale.abs() < 1e-9 {
            return Err(RuntimeError::InvalidPackage(format!(
                "invalid preprocessing parameters for feature '{feat}'"
            )));
        }

        let z = (val - mean) / scale;
        let z32 = z as f32;
        if !z.is_finite() || !z32.is_finite() {
            return Err(RuntimeError::Integrity(format!(
                "standardized value for feature '{feat}' is not finite"
            )));
        }
        standardized.push(z32);
    }

    Ok(standardized)
}

pub fn validate_preprocessing(
    feature_order: &[String],
    config: &PreprocessingConfig,
) -> Result<(), RuntimeError> {
    if !config.feature_order.is_empty() && config.feature_order != feature_order {
        return Err(RuntimeError::InvalidPackage(
            "preprocessing feature_order does not match runtime manifest".to_string(),
        ));
    }
    for feature in feature_order {
        let median = config.feature_medians.get(feature).ok_or_else(|| {
            RuntimeError::InvalidPackage(format!("missing preprocessing median for '{feature}'"))
        })?;
        let mean = config.feature_means.get(feature).ok_or_else(|| {
            RuntimeError::InvalidPackage(format!("missing preprocessing mean for '{feature}'"))
        })?;
        let scale = config.feature_scales.get(feature).ok_or_else(|| {
            RuntimeError::InvalidPackage(format!("missing preprocessing scale for '{feature}'"))
        })?;
        if !median.is_finite() || !mean.is_finite() || !scale.is_finite() || scale.abs() < 1e-9 {
            return Err(RuntimeError::InvalidPackage(format!(
                "non-finite or zero preprocessing parameter for '{feature}'"
            )));
        }
    }
    Ok(())
}
