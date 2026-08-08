# AURORA Model Runtime & Cross-Language Parity (Phase 6.6)

This document describes the immutable ONNX runtime package layout, Opset 17 export specification, and cross-language numerical parity guarantees between Python native PyTorch, Python ONNX Runtime, and Rust Inference.

---

## 1. Native Model vs Runtime Package

* **Native Model Package (Phase 6.5)**: Stored under `models/<task>/<model-id>/` containing `model.pt`, `preprocessing.json`, and `manifest.json`.
* **Runtime Package (Phase 6.6)**: Stored under `models/runtime/<task>/<runtime-package-id>/` containing `model.onnx`, `preprocessing.json`, `threshold.json`, `parity-fixture.json`, and `manifest.json`.
* **Immutability**: Runtime packages are derived, self-contained, and immutable once `manifest.json` is committed.

---

## 2. ONNX Export Specifications (`onnx-export-v1`)

* **Opset**: Explicitly pinned to Opset `17`.
* **Dynamic Batching**: Axis 0 is dynamic (`batch`), feature dimension is fixed.
* **Preprocessing Outside ONNX**: Imputation and standardization are performed outside the ONNX graph for transparency and exact Python/Rust parity.
* **Candidate Graph**:
  * Input: `features` (`[-1, 7]` of type `float32`).
  * Output: `logits` (`[-1]` of type `float32`).
* **Anomaly Graph**:
  * Input: `features` (`[-1, 16]` of type `float32`).
  * Output: `reconstruction` (`[-1, 16]` of type `float32`).

---

## 3. Scoring Formulas & Threshold Application

* **Candidate Vetting (`candidate-sigmoid-score-v1`)**:
  $$\text{score} = \sigma(\text{logit}) = \frac{1}{1 + e^{-\text{logit}}}$$
  $$\text{above\_threshold} = (\text{score} \ge \text{decision\_threshold})$$
* **Astronomical Anomaly Detection (`anomaly-reconstruction-mse-v1`)**:
  $$\text{MSE} = \frac{1}{D}\sum_{i=1}^{D} (x_i - \hat{x}_i)^2$$
  $$\text{above\_threshold} = (\text{MSE} \ge \text{decision\_threshold})$$

---

## 4. Cross-Language Numerical Parity & Qualification

* **Python Parity**: Mandatory pre-commit check verifying $|y_{\text{native}} - y_{\text{ort}}| \le 10^{-5}$ on CPU.
* **Rust Parity**: Verification against `parity-fixture.json` ensuring $|y_{\text{rust}} - y_{\text{ort}}| \le 10^{-5}$.
* **Device Policy**: CPU-only execution is mandatory for deterministic qualification; CUDA acceleration is optional.
* **Validation Records**: Persisted under `models/runtime-validations/` conforming to `model-runtime-validation-v1`.
