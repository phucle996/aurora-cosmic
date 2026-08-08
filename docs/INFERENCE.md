# AURORA Production Inference & Prediction Serving (Stage 7)

This document specifies the production inference workflow, runtime package qualification, job planning, and prediction data contracts for the AURORA Cosmic Data Platform.

---

## 1. Core Principles & Boundaries

1. **Gold-Only Input**:
   * Production inference operates strictly from committed Gold partition Parquet artifacts.
   * Zero Bronze reads and Zero Silver reads.
   * Remains fully functional if Bronze is `RAW_DELETED`.
2. **Immutable Runtime Package Pinning**:
   * Every inference job explicitly pins an exact `runtime_package_id` and `runtime_manifest_sha256`.
   * A job never mutates or re-resolves a model if the registry champion pointer changes mid-flight.
3. **Rust CUDA Qualification Requirement**:
   * Inference jobs are processed by the CUDA-enabled Rust ONNX Runtime worker after a verified `model-runtime-validation-v1` parity pass. CPU fallback is disabled so inference does not compete with ingest/preprocessing CPU capacity.
4. **Work Granularity**:
   * Exactly one inference job per committed Gold partition artifact.
   * Avoids row-level NATS flooding and provides natural retry isolation.
5. **Label-Independent Inference Eligibility**:
   * Inference scores all valid Gold rows (including `UNRESOLVED`).
   * Training labels supervise model training, whereas inference computes predictions for all contract-compatible target rows.

---

## 2. NATS Request Event Contracts

* **Candidate Subject**: `aurora.v1.inference.candidate.requested`
* **Anomaly Subject**: `aurora.v1.inference.anomaly.requested`
* **Stream Name**: `AURORA_INFERENCE`
* **Payload**: Lightweight job routing descriptor containing `job_id`, `job_manifest_key`, `job_manifest_sha256`, `runtime_package_id`, and `gold_artifact_key`. (No heavy Parquet or ONNX bytes).

---

## 3. Prediction Record Semantics

1. **Candidate Vetting (`prediction-candidate-v1`)**:
   * `raw_logit`: Float logit from the ONNX graph.
   * `candidate_score`: Stable Sigmoid $\sigma(\text{logit}) = \frac{1}{1 + e^{-\text{logit}}} \in [0.0, 1.0]$.
   * `above_threshold`: `candidate_score >= decision_threshold`.
   * *Guardrail*: Predictions represent vetting scores, NOT scientific confirmation (`is_planet` is forbidden).
2. **Astronomical Anomaly Detection (`prediction-anomaly-v1`)**:
   * `reconstruction_mse`: $\frac{1}{D}\sum_{i=1}^{D}(x_i - \hat{x}_i)^2$ in standardized feature space.
   * `above_threshold`: `reconstruction_mse >= decision_threshold`.
   * *Guardrail*: Anomaly scores measure statistical reconstruction deviation, NOT extraterrestrial signals.
3. **Model-Input Hashing (`model_input_sha256`)**:
   * SHA-256 computed across little-endian raw bytes of the ordered `float32` standardized input tensor.
