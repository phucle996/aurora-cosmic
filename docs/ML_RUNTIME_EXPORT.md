# AURORA ONNX Export & Rust Inference Parity (Phase 6.6)

This document describes the runtime package layout, ONNX export specifications, and cross-language numerical parity guarantees between Python PyTorch, Python ONNX Runtime, and Rust Inference.

---

## 1. Runtime Package Storage Layout

Runtime packages are immutable and organized by task:
```text
models/runtime/
├── candidate/
│   └── <runtime-package-id>/
│       ├── model.onnx
│       ├── preprocessing.json
│       ├── threshold.json
│       ├── parity-fixture.json
│       └── manifest.json
│
└── anomaly/
    └── <runtime-package-id>/
        ├── model.onnx
        ├── preprocessing.json
        ├── threshold.json
        ├── parity-fixture.json
        └── manifest.json
```

---

## 2. ONNX Export Specifications (`onnx-export-v1`)

* **Opset**: Explicitly pinned to Opset `17`.
* **Dynamic Batching**: Axis 0 is dynamic (`batch`), feature dimension is fixed.
* **Candidate Graph**:
  * Input tensor: `features` with shape `[-1, 7]` of type `float32`.
  * Output tensor: `logits` with shape `[-1]` of type `float32`.
* **Anomaly Graph**:
  * Input tensor: `features` with shape `[-1, 16]` of type `float32`.
  * Output tensor: `reconstruction` with shape `[-1, 16]` of type `float32`.

---

## 3. Cross-Language Numerical Parity

1. **Preprocessing**:
   * Null values are imputed using TRAIN medians.
   * Features are standardized via $z = (x - \mu) / \sigma$ using float64 math and cast to float32 tensors.
2. **Candidate Scoring**:
   * Numerically stable sigmoid: $\sigma(z) = \frac{1}{1 + e^{-z}}$.
   * Classification flag: $\text{above\_threshold} = (\text{score} \ge \text{decision\_threshold})$.
3. **Anomaly Scoring**:
   * Reconstruction Mean Squared Error: $\text{MSE} = \frac{1}{D}\sum (x_i - \hat{x}_i)^2$.
   * Anomaly alert flag: $\text{above\_threshold} = (\text{MSE} \ge \text{decision\_threshold})$.
4. **Tolerance**:
   * Numerical difference between Python native, Python ONNX Runtime, and Rust inference must strictly satisfy:
     $$|y_{\text{native}} - y_{\text{ort}}| \le 10^{-5}$$
     $$\frac{|y_{\text{native}} - y_{\text{ort}}|}{|y_{\text{native}}| + 10^{-9}} \le 10^{-5}$$
