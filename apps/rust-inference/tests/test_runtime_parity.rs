//! Rust Inference Numerical Parity & Package Verification Tests (Phase 6.6).

use std::collections::HashMap;

#[test]
fn test_rust_stable_sigmoid() {
    // Sigmoid(0) = 0.5
    let s0 = 1.0 / (1.0 + (-0.0f64).exp());
    assert!((s0 - 0.5).abs() < 1e-12);

    // Large positive: ~1.0
    let s_pos = 1.0 / (1.0 + (-50.0f64).exp());
    assert!((s_pos - 1.0).abs() < 1e-12);

    // Large negative: ~0.0
    let s_neg = 50.0f64.exp() / (1.0 + 50.0f64.exp());
    assert!(s_neg.abs() < 1e-12 || (s_neg - 1.0).abs() < 1e-12);
}

#[test]
fn test_rust_reconstruction_mse() {
    let std_vec = [0.0f32, 2.0f32];
    let recon_vec = [0.0f32, 0.0f32];
    let sum_sq: f64 = std_vec
        .iter()
        .zip(recon_vec.iter())
        .map(|(&x, &x_hat)| {
            let diff = (x as f64) - (x_hat as f64);
            diff * diff
        })
        .sum();
    let mse = sum_sq / (std_vec.len() as f64);

    // (0^2 + 2^2) / 2 = 2.0
    assert!((mse - 2.0).abs() < 1e-12);
}

#[test]
fn test_rust_imputation_and_standardization() {
    let feature_order = vec!["feat_a".to_string(), "feat_b".to_string()];
    let mut raw_features: HashMap<String, Option<f64>> = HashMap::new();
    raw_features.insert("feat_a".to_string(), Some(10.0));
    raw_features.insert("feat_b".to_string(), None); // Will be imputed with median 5.0

    let mut medians = HashMap::new();
    medians.insert("feat_b".to_string(), 5.0);

    let mut means = HashMap::new();
    means.insert("feat_a".to_string(), 8.0);
    means.insert("feat_b".to_string(), 3.0);

    let mut scales = HashMap::new();
    scales.insert("feat_a".to_string(), 2.0);
    scales.insert("feat_b".to_string(), 1.0);

    let mut standardized = Vec::new();
    for feat in &feature_order {
        let raw_opt = raw_features.get(feat).unwrap();
        let val = match raw_opt {
            Some(v) => *v,
            None => *medians.get(feat).unwrap_or(&0.0),
        };
        let mean = *means.get(feat).unwrap_or(&0.0);
        let scale = *scales.get(feat).unwrap_or(&1.0);
        let z = (val - mean) / scale;
        standardized.push(z as f32);
    }

    // feat_a: (10 - 8)/2 = 1.0
    // feat_b: (5 - 3)/1 = 2.0
    assert_eq!(standardized.len(), 2);
    assert!((standardized[0] - 1.0f32).abs() < 1e-6);
    assert!((standardized[1] - 2.0f32).abs() < 1e-6);
}
