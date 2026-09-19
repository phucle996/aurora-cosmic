"""Benchmark, OS Kernel Diagnostics & Bottleneck Profiler CLI Runner for Aurora Enrichment.

Runs all test bench scenarios, aggregates fine-grained heap allocation metrics
from tracemalloc, OS kernel telemetry (CPU time, context switches, page faults)
from getrusage, stage/phase latencies, and outputs formatted benchmark tables.

Usage:
    uv run python -m benches.runner
    uv run python -m benches.runner --scenario throughput
"""

from __future__ import annotations

import argparse
import sys
import time

from benches.profiler import HeapProfileResult, format_bytes
from benches.scenarios.concurrency import run_concurrency_benchmark
from benches.scenarios.fault_chaos import run_fault_chaos_benchmark
from benches.scenarios.heap_tpf_memmap import run_heap_tpf_benchmark
from benches.scenarios.throughput import run_throughput_benchmark
from benches.scenarios.wave_admission import run_wave_admission_benchmark


def print_results_table(results: list[tuple[HeapProfileResult, bool, str]]) -> None:
    """Print master summary table with Heap, OS RSS, CPU, and Bottleneck diagnosis."""
    header = (
        f"{'Scenario Name':<38} "
        f"{'Duration':>9} "
        f"{'Throughput':>11} "
        f"{'Peak Heap':>10} "
        f"{'Heap Delta':>10} "
        f"{'CPU Util':>9} "
        f"{'Lock/IO Sw':>11} "
        f"{'Bottleneck Diagnosis':<24} "
        f"{'Status':>6}"
    )
    separator = "=" * len(header)
    sub_separator = "-" * len(header)

    print("\n" + separator)
    print(" AURORA ENRICHMENT — HEAP ALLOCATION & BOTTLENECK ANALYSIS REPORT")
    print(separator)
    print(header)
    print(sub_separator)

    for profile, passed, _ in results:
        status = "PASS" if passed else "FAIL"
        duration_str = f"{profile.duration_seconds * 1000:.1f} ms"
        throughput_str = (
            f"{profile.throughput_items_per_second:.1f} it/s"
            if profile.throughput_items_per_second > 0
            else "N/A"
        )
        peak_heap_str = format_bytes(profile.peak_heap_bytes)
        heap_delta_str = format_bytes(profile.heap_delta_bytes)
        cpu_util_str = f"{profile.cpu_utilization_pct:.1f}%"
        switches_str = str(profile.voluntary_context_switches)
        diagnosis = profile.identify_bottleneck()["category"]

        name = profile.name[:36]
        print(
            f"{name:<38} "
            f"{duration_str:>9} "
            f"{throughput_str:>11} "
            f"{peak_heap_str:>10} "
            f"{heap_delta_str:>10} "
            f"{cpu_util_str:>9} "
            f"{switches_str:>11} "
            f"{diagnosis:<24} "
            f"{status:>6}"
        )

    print(separator + "\n")


def print_stage_breakdowns(
    results: list[tuple[HeapProfileResult, bool, str]],
) -> None:
    """Print granular stage-by-stage latency and memory breakdown for complex workflows."""
    has_stages = any(profile.phases for profile, _, _ in results)
    if not has_stages:
        return

    print("=" * 110)
    print(" STAGE LATENCY & MEMORY BREAKDOWN (BOTTLENECK ROOT-CAUSE)")
    print("=" * 110)

    for profile, _, _ in results:
        if not profile.phases:
            continue
        diag = profile.identify_bottleneck()
        print(
            f"\n[ {profile.name} ] — Duration: {profile.duration_seconds * 1000:.1f} ms | Overall: {diag['category']}"
        )
        if diag["culprit_stage"]:
            print(f"  * Primary Bottleneck: {diag['culprit_stage']} — {diag['reason']}")
        print(
            f"  {'Stage / Phase Name':<40} {'Duration (ms)':>14} {'% Total':>9} {'CPU Util':>10} {'Peak Heap':>12} {'Heap Delta':>12}"
        )
        print("  " + "-" * 100)

        for p in profile.phases:
            print(
                f"  {p.name:<40} "
                f"{p.duration_ms:>14.1f} "
                f"{p.pct_of_total_duration:>8.1f}% "
                f"{p.cpu_utilization_pct:>9.1f}% "
                f"{format_bytes(p.peak_heap_bytes):>12} "
                f"{format_bytes(p.heap_delta_bytes):>12}"
            )
    print("-" * 110 + "\n")


def print_latency_distributions(
    results: list[tuple[HeapProfileResult, bool, str]],
) -> None:
    """Print per-target tail latency percentiles (P50, P90, P99, Max)."""
    has_latencies = any(profile.per_item_latencies for profile, _, _ in results)
    if not has_latencies:
        return

    print("=" * 90)
    print(" PER-TARGET LATENCY DISTRIBUTION & TAIL LATENCY (HEAD-OF-LINE BLOCKING)")
    print("=" * 90)
    print(
        f"{'Scenario Name':<38} {'Count':>7} {'P50 (ms)':>10} {'P90 (ms)':>10} {'P99 (ms)':>10} {'Max (ms)':>10}"
    )
    print("-" * 90)

    for profile, _, _ in results:
        if not profile.per_item_latencies:
            continue
        name = profile.name[:36]
        print(
            f"{name:<38} "
            f"{len(profile.per_item_latencies):>7} "
            f"{profile.p50_latency_ms:>10.1f} "
            f"{profile.p90_latency_ms:>10.1f} "
            f"{profile.p99_latency_ms:>10.1f} "
            f"{profile.max_latency_ms:>10.1f}"
        )
    print("-" * 90 + "\n")


def print_top_allocations(results: list[tuple[HeapProfileResult, bool, str]]) -> None:
    """Print top allocation call sites for each scenario."""
    print("=" * 80)
    print(" TOP HEAP ALLOCATION SITES BY SCENARIO (TRACEMALLOC)")
    print("=" * 80)
    for profile, _, _ in results:
        if profile.top_allocations:
            print(f"\n[ {profile.name} ]")
            for stat in profile.top_allocations[:3]:
                print(f"  • {stat}")
    print("\n" + "=" * 80)


def main() -> int:
    """Execute benchmarks based on CLI flags."""
    parser = argparse.ArgumentParser(
        description="Run Aurora Enrichment benchmarks, measure allocated heap & diagnose bottlenecks."
    )
    parser.add_argument(
        "--scenario",
        choices=["all", "wave", "tpf", "concurrency", "chaos", "throughput"],
        default="all",
        help="Specific scenario to execute (default: all)",
    )
    args = parser.parse_args()

    suite_start = time.perf_counter()
    results: list[tuple[HeapProfileResult, bool, str]] = []

    def execute_safely(
        func: object, name: str, *func_args: object, **func_kwargs: object
    ) -> None:
        try:
            res = func(*func_args, **func_kwargs)  # type: ignore[operator]
            if isinstance(res, list):
                for item in res:
                    results.append((item, True, ""))
            else:
                results.append((res, True, ""))
        except Exception as exc:
            dummy = HeapProfileResult(
                name=name,
                duration_seconds=0.0,
                start_heap_bytes=0,
                peak_heap_bytes=0,
                end_heap_bytes=0,
                heap_delta_bytes=0,
                start_rss_bytes=0,
                end_rss_bytes=0,
                peak_rss_bytes=0,
                rss_delta_bytes=0,
            )
            results.append((dummy, False, str(exc)))

    # 1. Wave Admission
    if args.scenario in {"all", "wave"}:
        execute_safely(run_wave_admission_benchmark, "Wave Admission")

    # 2. TPF Heap & Memmap Bounding
    if args.scenario in {"all", "tpf"}:
        execute_safely(run_heap_tpf_benchmark, "TPF RAM/Memmap Extraction")

    # 3. Concurrency
    if args.scenario in {"all", "concurrency"}:
        execute_safely(run_concurrency_benchmark, "Concurrency (4 Workers)")

    # 4. Fault & Chaos
    if args.scenario in {"all", "chaos"}:
        execute_safely(run_fault_chaos_benchmark, "Fault & Chaos Injection")

    # 5. Throughput
    if args.scenario in {"all", "throughput"}:
        execute_safely(run_throughput_benchmark, "E2E Throughput")

    print_results_table(results)
    print_stage_breakdowns(results)
    print_latency_distributions(results)
    print_top_allocations(results)

    total_duration = time.perf_counter() - suite_start
    all_passed = all(passed for _, passed, _ in results)
    print(
        f"Ran {len(results)} benchmarks in {total_duration:.2f}s — "
        f"{'ALL PASSED' if all_passed else 'SOME FAILED'}"
    )

    return 0 if all_passed else 1


if __name__ == "__main__":
    sys.exit(main())
