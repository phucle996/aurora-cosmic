# anomaly-explanation-v1

`anomaly-explanation-v1` is an immutable, per-prediction audit sidecar for the
`astronomical_anomaly_detection` task. It is written by Rust inference next to
the prediction JSONL output:

```text
explanations/anomaly/{prediction_id}.json
```

The prediction record remains the compact decision contract. This sidecar makes
the decision reproducible for a human reviewer without recomputing values in
the browser.

For each model feature it stores:

- `gold_value`: exact value read from the Gold Parquet row, nullable;
- `model_value`: Gold value or the runtime package's training median when the
  Gold value is null;
- `mean`, `scale`: immutable preprocessing parameters;
- `standardized_input`: `(model_value - mean) / scale`, the actual ONNX input;
- `reconstruction`: the autoencoder output for that dimension;
- `residual`, `squared_residual`: `z - reconstruction` and its square;
- `contribution`: `squared_residual / sum(all squared residuals)`.

The score is exactly:

```text
reconstruction_mse = sum(squared_residual) / number_of_features
FLAGGED = reconstruction_mse >= decision_threshold
```

The sidecar also carries Gold snapshot, runtime package, validation record,
preprocessing/split IDs and `model_input_sha256`. This makes the displayed
diff a trace of the actual model execution rather than a post-hoc explanation.
