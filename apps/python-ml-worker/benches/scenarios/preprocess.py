"""Scenario 3: Pre-train Dataset View, Group-Safe Splits & Preprocessing Benchmark."""

from __future__ import annotations

from benches.generator import generate_synthetic_catalog_rows
from benches.profiler import MlProfiler, MlProfileResult
from pre_train import (
    CandidatePreprocessor,
    build_candidate_ml_view,
    create_deterministic_group_split,
    derive_group_key,
)
from store import SnapshotManifest


def run_preprocess_benchmark(
    num_objects: int = 500,
    observations_per_object: int = 10,
) -> tuple[MlProfileResult, bool, str]:
    """Benchmark Stage 1 Pre-training pipeline: View -> Group Split -> Fit -> Transform."""
    total_rows = num_objects * observations_per_object
    scenario_name = f"pre_train_etl_{total_rows}_rows"
    profiler = MlProfiler(scenario_name=scenario_name, item_count=total_rows)

    rows = generate_synthetic_catalog_rows(
        num_objects=num_objects,
        observations_per_object=observations_per_object,
    )
    manifest = SnapshotManifest(
        snapshot_id="gold-v1-bench-etl",
        manifest_sha256="c" * 64,
        snapshot_fingerprint="fp-" + ("c" * 32),
        snapshot_type="CANDIDATE",
        input_count=len(rows),
        created_at="2026-09-21T00:00:00Z",
    )

    def workload() -> None:
        # 1. Build view
        with profiler.stage("build_ml_view"):
            view = build_candidate_ml_view(manifest, rows)

        # 2. Deterministic group-safe split
        with profiler.stage("group_safe_split"):
            split = create_deterministic_group_split(view, seed=42)

        # 3. Fit preprocessor
        with profiler.stage("preprocessor_fit"):
            train_keys = {
                assign.group_key
                for assign in split.assignments
                if assign.split == "TRAIN"
            }
            train_rows = [r for r in rows if derive_group_key(r) in train_keys]
            prep = CandidatePreprocessor().fit(train_rows, split_id=split.split_id)

        # 4. Transform features & labels
        with profiler.stage("transform_features"):
            _ = prep.transform_features(rows)
            _ = prep.transform_labels(rows)

    result = profiler.run(workload)
    passed = result.duration_seconds > 0 and result.item_count == total_rows
    message = (
        f"Processed {total_rows:,} rows across {num_objects:,} objects. "
        f"Throughput: {result.throughput_items_per_second:,.1f} rows/s. "
        f"Heap Delta: {result.heap_delta_bytes / (1024*1024):.2f} MiB."
    )
    return result, passed, message
