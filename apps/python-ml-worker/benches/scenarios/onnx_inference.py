"""Scenario 2: PyTorch vs ONNX Runtime Inference Latency & Parity Benchmark."""

from __future__ import annotations

import io
import time
import numpy as np
import onnxruntime as ort
import torch

from benches.generator import build_benchmark_model
from benches.profiler import MlProfiler, MlProfileResult
from pre_train.view import CANDIDATE_MODEL_INPUT_FEATURES


def run_onnx_inference_benchmark(
    batch_size: int = 64,
    iterations: int = 200,
) -> tuple[MlProfileResult, bool, str]:
    """Benchmark and compare PyTorch and ONNX Runtime inference latency and numerical parity."""
    scenario_name = f"onnx_parity_inference_b{batch_size}"
    total_inferences = batch_size * iterations
    profiler = MlProfiler(scenario_name=scenario_name, item_count=total_inferences)

    input_dim = len(CANDIDATE_MODEL_INPUT_FEATURES)
    model = build_benchmark_model(device="cpu").eval()

    # 1. Export in-memory ONNX buffer
    onnx_buffer = io.BytesIO()
    dummy_input = torch.randn(1, input_dim, dtype=torch.float32)
    torch.onnx.export(
        model,
        dummy_input,
        onnx_buffer,
        input_names=["input"],
        output_names=["logits"],
        dynamic_axes={"input": {0: "batch_size"}, "logits": {0: "batch_size"}},
        opset_version=17,
    )
    onnx_bytes = onnx_buffer.getvalue()

    # 2. Configure ONNX Runtime session
    opts = ort.SessionOptions()
    opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    opts.inter_op_num_threads = 1
    opts.intra_op_num_threads = 4
    session = ort.InferenceSession(onnx_bytes, sess_options=opts, providers=["CPUExecutionProvider"])
    input_name = session.get_inputs()[0].name

    # 3. Generate test batches
    test_batches = [
        np.random.randn(batch_size, input_dim).astype(np.float32)
        for _ in range(iterations)
    ]

    latencies_ms: list[float] = []
    max_parity_diff = 0.0

    def workload() -> None:
        nonlocal max_parity_diff
        for batch_np in test_batches:
            t0 = time.perf_counter()

            # PyTorch forward
            with profiler.stage("pytorch_eval"), torch.no_grad():
                batch_tensor = torch.from_numpy(batch_np)
                py_logits = model(batch_tensor).numpy()

            # ONNX Runtime forward
            with profiler.stage("onnx_eval"):
                onnx_logits = session.run(None, {input_name: batch_np})[0]

            batch_ms = (time.perf_counter() - t0) * 1000
            latencies_ms.append(batch_ms)

            # Check parity
            diff = float(np.max(np.abs(py_logits - onnx_logits)))
            if diff > max_parity_diff:
                max_parity_diff = diff

    result = profiler.run(workload)
    profiler.set_percentiles(latencies_ms)
    result.percentiles = profiler._percentiles

    parity_passed = max_parity_diff < 1e-4
    message = (
        f"Evaluated {total_inferences:,} inferences across {iterations} batches (batch={batch_size}). "
        f"P50: {result.percentiles.get('p50_ms', 0):.2f}ms, P99: {result.percentiles.get('p99_ms', 0):.2f}ms. "
        f"Max parity abs diff: {max_parity_diff:.2e} (threshold < 1e-4: {parity_passed})."
    )
    return result, parity_passed, message
