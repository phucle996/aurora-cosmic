"""Scenario 4: Post-train Multi-Cohort Evaluation & Threshold Sweep Benchmark."""

from __future__ import annotations

import numpy as np

from benches.generator import (
    generate_benchmark_split_and_data,
)
from benches.profiler import MlProfiler, MlProfileResult
from post_train.evaluate import (
    build_candidate_golden_cohort,
    build_candidate_recent_cohort,
    calculate_candidate_cohort_metrics,
    check_group_contamination,
    select_candidate_validation_threshold,
)


def run_evaluation_benchmark(
    num_objects: int = 300,
    sweep_iterations: int = 50,
) -> tuple[MlProfileResult, bool, str]:
    """Benchmark Stage 3 Evaluation: Golden/Recent cohort build -> Leakage Check -> Threshold Sweep."""
    manifest, split, rows, prep = generate_benchmark_split_and_data(
        num_objects=num_objects, seed=42
    )
    total_evals = len(rows) * sweep_iterations
    scenario_name = f"multi_cohort_eval_{len(rows)}_items"
    profiler = MlProfiler(scenario_name=scenario_name, item_count=total_evals)

    def workload() -> None:
        # 1. Build Golden & Recent cohorts
        with profiler.stage("build_cohorts"):
            golden_cohort = build_candidate_golden_cohort(
                gold_manifest=manifest,
                candidate_rows=rows,
                training_split=split,
            )
            recent_cohort = build_candidate_recent_cohort(
                gold_manifest=manifest,
                candidate_rows=rows,
                training_split=split,
                golden_cohort=golden_cohort,
            )

        # 2. Group contamination leakage check
        with profiler.stage("leakage_check"):
            check_group_contamination(
                cohort_group_keys=golden_cohort.group_keys,
                training_split=split,
            )
            check_group_contamination(
                cohort_group_keys=recent_cohort.group_keys,
                training_split=split,
                other_cohort_group_keys=golden_cohort.group_keys,
            )

        # 3. Simulate validation predictions & threshold optimization sweep
        with profiler.stage("threshold_optimization_sweep"):
            y_true = np.array(
                [1.0 if r["training_label"] == "POSITIVE" else 0.0 for r in rows],
                dtype=np.float32,
            )
            y_prob = np.random.uniform(0.01, 0.99, size=len(rows)).astype(np.float32)

            for _ in range(sweep_iterations):
                threshold, *_ = select_candidate_validation_threshold(y_true, y_prob)
                _ = calculate_candidate_cohort_metrics(y_true, y_prob, threshold)

    result = profiler.run(workload)
    passed = result.duration_seconds > 0
    message = (
        f"Evaluated cohorts across {len(rows):,} observations with {sweep_iterations} threshold sweeps. "
        f"Throughput: {result.throughput_items_per_second:,.1f} evals/s."
    )
    return result, passed, message
