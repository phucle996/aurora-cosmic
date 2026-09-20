"""Scenario 1: Candidate Model Training Throughput & VRAM Profiling."""

from __future__ import annotations

import time
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset

from benches.generator import (
    build_benchmark_model,
    generate_benchmark_torch_dataset,
)
from benches.profiler import MlProfiler, MlProfileResult


def run_training_benchmark(
    device_str: str = "cuda" if torch.cuda.is_available() else "cpu",
    batch_size: int = 128,
    num_samples: int = 5000,
    epochs: int = 5,
    use_amp: bool = True,
) -> tuple[MlProfileResult, bool, str]:
    """Benchmark full PyTorch training loop on CPU or GPU.

    Measures forward pass, backward pass, optimizer step, loss calculation,
    peak VRAM allocation, and gradient throughput.
    """
    scenario_name = f"training_{device_str}_{'amp' if use_amp and device_str == 'cuda' else 'fp32'}"
    target_device = (
        torch.device("cuda:0")
        if device_str == "cuda" and torch.cuda.is_available()
        else torch.device("cpu")
    )
    features, targets = generate_benchmark_torch_dataset(
        num_samples=num_samples, device="cpu"
    )
    dataset = TensorDataset(features, targets)
    loader = DataLoader(
        dataset,
        batch_size=batch_size,
        shuffle=True,
        pin_memory=(target_device.type == "cuda"),
    )
    total_steps = len(loader) * epochs
    profiler = MlProfiler(scenario_name=scenario_name, item_count=num_samples * epochs)
    model = build_benchmark_model(device=str(target_device))
    criterion = nn.BCEWithLogitsLoss()
    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-3, weight_decay=1e-4)
    scaler = (
        torch.amp.GradScaler("cuda")
        if use_amp and target_device.type == "cuda"
        else None
    )

    batch_latencies_ms: list[float] = []

    def workload() -> None:
        model.train()
        for _ in range(epochs):
            for batch_x, batch_y in loader:
                t0 = time.perf_counter()
                batch_x = batch_x.to(target_device, non_blocking=True)
                batch_y = batch_y.to(target_device, non_blocking=True)

                optimizer.zero_grad(set_to_none=True)

                with profiler.stage("forward_pass"):
                    if scaler is not None:
                        with torch.amp.autocast("cuda"):
                            logits = model(batch_x)
                            loss = criterion(logits, batch_y)
                    else:
                        logits = model(batch_x)
                        loss = criterion(logits, batch_y)

                with profiler.stage("backward_pass"):
                    if scaler is not None:
                        scaler.scale(loss).backward()
                        scaler.step(optimizer)
                        scaler.update()
                    else:
                        loss.backward()
                        optimizer.step()

                if target_device.type == "cuda":
                    torch.cuda.synchronize()

                batch_ms = (time.perf_counter() - t0) * 1000
                batch_latencies_ms.append(batch_ms)

    result = profiler.run(workload)
    profiler.set_percentiles(batch_latencies_ms)
    result.percentiles = profiler._percentiles

    passed = result.duration_seconds > 0 and len(batch_latencies_ms) == total_steps
    message = (
        f"Trained {num_samples * epochs:,} samples over {epochs} epochs on {target_device}. "
        f"Throughput: {result.throughput_items_per_second:,.1f} samples/s. "
        f"Peak VRAM: {result.gpu.peak_vram_allocated_bytes / (1024*1024):.1f} MiB."
    )
    return result, passed, message
