"""Benchmark, OS Diagnostics & GPU Telemetry CLI Runner for Aurora ML Worker.

Runs all ML workload scenarios, captures Host Heap, OS Kernel telemetry,
PyTorch CUDA VRAM allocations, and NVIDIA NVML hardware metrics,
outputting formatted diagnostic tables.

Usage:
    uv run python -m benches.runner
    uv run python -m benches.runner --scenario training
    uv run python -m benches.runner --scenario onnx
"""

from __future__ import annotations

import argparse
import sys
import time

import torch

from benches.profiler import MlProfileResult, format_bytes
from benches.scenarios.evaluation import run_evaluation_benchmark
from benches.scenarios.onnx_inference import run_onnx_inference_benchmark
from benches.scenarios.preprocess import run_preprocess_benchmark
from benches.scenarios.training import run_training_benchmark


def print_results_table(results: list[tuple[MlProfileResult, bool, str]]) -> None:
    """Print consolidated benchmark table with Host, OS, GPU, and Bottleneck diagnostics."""
    header = (
        f"{'Scenario Name':<32} "
        f"{'Device':<8} "
        f"{'Duration':>9} "
        f"{'Throughput':>12} "
        f"{'Peak Heap':>10} "
        f"{'Peak VRAM':>10} "
        f"{'GPU Util':>9} "
        f"{'CPU Util':>9} "
        f"{'Bottleneck Diagnosis':<22} "
        f"{'Status':>6}"
    )
    separator = "=" * len(header)
    sub_separator = "-" * len(header)

    print("\n" + separator)
    print(" AURORA ML WORKER — HOST, OS & GPU BENCHMARK REPORT")
    print(separator)
    print(header)
    print(sub_separator)

    for profile, passed, _ in results:
        status = "PASS" if passed else "FAIL"
        duration_str = f"{profile.duration_seconds * 1000:.1f} ms"
        if profile.duration_seconds >= 1.0:
            duration_str = f"{profile.duration_seconds:.2f} s"

        throughput_str = (
            f"{profile.throughput_items_per_second:,.1f} it/s"
            if profile.throughput_items_per_second > 0
            else "N/A"
        )
        dev_str = "CUDA:0" if profile.gpu.gpu_available else "CPU"
        peak_heap_str = format_bytes(profile.peak_heap_bytes)
        peak_vram_str = (
            format_bytes(profile.gpu.peak_vram_allocated_bytes)
            if profile.gpu.gpu_available
            else "N/A"
        )
        gpu_util_str = (
            f"{profile.gpu.gpu_utilization_pct:.1f}%"
            if profile.gpu.gpu_available
            else "N/A"
        )
        cpu_util_str = f"{profile.cpu_utilization_pct:.1f}%"
        diagnosis = profile.identify_bottleneck()["category"]

        print(
            f"{profile.scenario_name:<32} "
            f"{dev_str:<8} "
            f"{duration_str:>9} "
            f"{throughput_str:>12} "
            f"{peak_heap_str:>10} "
            f"{peak_vram_str:>10} "
            f"{gpu_util_str:>9} "
            f"{cpu_util_str:>9} "
            f"{diagnosis:<22} "
            f"{status:>6}"
        )

    print(separator)


def print_gpu_telemetry_table(results: list[tuple[MlProfileResult, bool, str]]) -> None:
    """Print dedicated GPU hardware and VRAM telemetry table."""
    gpu_results = [r for r in results if r[0].gpu.gpu_available]
    if not gpu_results:
        print("\n[GPU Telemetry]: No GPU devices active during benchmark run.")
        return

    header = (
        f"{'Scenario Name':<32} "
        f"{'GPU Device':<26} "
        f"{'Temp':>6} "
        f"{'Alloc VRAM':>11} "
        f"{'Resrv VRAM':>11} "
        f"{'VRAM Delta':>11} "
        f"{'Core Util':>10} "
        f"{'Mem Util':>9}"
    )
    separator = "=" * len(header)
    sub_separator = "-" * len(header)

    print("\n" + separator)
    print(" AURORA ML WORKER — GPU HARDWARE & VRAM DETAILED METRICS")
    print(separator)
    print(header)
    print(sub_separator)

    for profile, _, _ in gpu_results:
        gpu = profile.gpu
        temp_str = f"{gpu.gpu_temp_celsius}°C" if gpu.gpu_temp_celsius > 0 else "n/a"
        alloc_str = format_bytes(gpu.peak_vram_allocated_bytes)
        res_str = format_bytes(gpu.peak_vram_reserved_bytes)
        delta_str = format_bytes(gpu.vram_allocated_delta_bytes)
        core_util = f"{gpu.gpu_utilization_pct:.1f}%"
        mem_util = f"{gpu.gpu_memory_utilization_pct:.1f}%"

        print(
            f"{profile.scenario_name:<32} "
            f"{gpu.device_name[:25]:<26} "
            f"{temp_str:>6} "
            f"{alloc_str:>11} "
            f"{res_str:>11} "
            f"{delta_str:>11} "
            f"{core_util:>10} "
            f"{mem_util:>9}"
        )

    print(separator)


def print_scenario_detail(profile: MlProfileResult, message: str) -> None:
    """Print detailed stage latency breakdowns and percentiles."""
    print(f"\n--- Scenario: {profile.scenario_name} ---")
    print(f"Summary: {message}")
    bottleneck = profile.identify_bottleneck()
    print(f"Bottleneck: {bottleneck['category']} - {bottleneck['reason']}")
    print(f"Recommendation: {bottleneck['action']}")

    if profile.percentiles:
        p = profile.percentiles
        print(
            f"Latency Percentiles: Min={p.get('min_ms')}ms | "
            f"P50={p.get('p50_ms')}ms | P90={p.get('p90_ms')}ms | "
            f"P99={p.get('p99_ms')}ms | Max={p.get('max_ms')}ms"
        )

    if profile.stage_latencies:
        print("Pipeline Stage Breakdown:")
        total_dur = max(profile.duration_seconds, 1e-9)
        for stage_name, stage_sec in sorted(
            profile.stage_latencies.items(), key=lambda x: x[1], reverse=True
        ):
            pct = (stage_sec / total_dur) * 100.0
            h_delta = profile.stage_heap_deltas.get(stage_name, 0)
            print(
                f"  - {stage_name:<28}: {stage_sec * 1000:>7.2f} ms ({pct:>5.1f}%) | "
                f"Heap: {format_bytes(h_delta)}"
            )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Aurora ML Worker Performance & GPU Benchmark Suite"
    )
    parser.add_argument(
        "--scenario",
        choices=["all", "training", "onnx", "preprocess", "evaluation"],
        default="all",
        help="Specific scenario to execute (default: all)",
    )
    parser.add_argument(
        "--device",
        choices=["auto", "cuda", "cpu"],
        default="auto",
        help="Compute device target (default: auto detects CUDA)",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print granular stage breakdown and recommendations",
    )
    args = parser.parse_args()

    chosen_device = (
        "cuda"
        if args.device == "cuda"
        or (args.device == "auto" and torch.cuda.is_available())
        else "cpu"
    )

    print(
        f"[aurora-ml-bench] Starting benchmark suite on target device: {chosen_device.upper()} "
        f"(PyTorch {torch.__version__})"
    )

    results: list[tuple[MlProfileResult, bool, str]] = []
    start_all = time.perf_counter()

    # 1. Pre-train ETL
    if args.scenario in ("all", "preprocess"):
        print("Running: Pre-train Dataset View & Group Split benchmark...")
        results.append(
            run_preprocess_benchmark(num_objects=500, observations_per_object=10)
        )

    # 2. Training (Run GPU/CUDA if available, plus CPU if requested)
    if args.scenario in ("all", "training"):
        print(
            f"Running: Candidate Model Training benchmark on {chosen_device.upper()}..."
        )
        results.append(
            run_training_benchmark(
                device_str=chosen_device,
                batch_size=128,
                num_samples=5000,
                epochs=5,
                use_amp=True,
            )
        )
        if chosen_device == "cuda":
            print("Running: Candidate Model Training comparison on CPU...")
            results.append(
                run_training_benchmark(
                    device_str="cpu",
                    batch_size=128,
                    num_samples=2500,
                    epochs=3,
                    use_amp=False,
                )
            )

    # 3. ONNX vs PyTorch Inference
    if args.scenario in ("all", "onnx"):
        print("Running: ONNX Runtime vs PyTorch inference parity benchmark...")
        results.append(run_onnx_inference_benchmark(batch_size=64, iterations=100))

    # 4. Multi-Cohort Evaluation
    if args.scenario in ("all", "evaluation"):
        print("Running: Post-train Multi-Cohort Evaluation benchmark...")
        results.append(run_evaluation_benchmark(num_objects=300, sweep_iterations=50))

    total_wall_time = time.perf_counter() - start_all

    # Print summaries
    print_results_table(results)
    print_gpu_telemetry_table(results)

    if args.verbose:
        for profile, _, msg in results:
            print_scenario_detail(profile, msg)

    all_passed = all(passed for _, passed, _ in results)
    print(f"\nCompleted {len(results)} benchmark scenarios in {total_wall_time:.2f}s.")
    print(f"Overall Benchmark Status: {'SUCCESS' if all_passed else 'FAILED'}")
    return 0 if all_passed else 1


if __name__ == "__main__":
    sys.exit(main())
