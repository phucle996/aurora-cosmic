"""Benchmark scenarios for Aurora ML Worker."""

from benches.scenarios.evaluation import run_evaluation_benchmark
from benches.scenarios.onnx_inference import run_onnx_inference_benchmark
from benches.scenarios.preprocess import run_preprocess_benchmark
from benches.scenarios.training import run_training_benchmark

__all__ = [
    "run_training_benchmark",
    "run_onnx_inference_benchmark",
    "run_preprocess_benchmark",
    "run_evaluation_benchmark",
]
