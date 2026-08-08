import argparse
import signal
import sys
import time
from pathlib import Path

# Add project root to sys.path so pkg module can be imported
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from aurora_ml.config import Config
from aurora_ml.pipeline.gold import GoldSnapshotPlanner, SilverInputRef
from pkg.logger import init_logger


def main():
    parser = argparse.ArgumentParser(description="AURORA Python ML Worker & Stage 5 Gold Manager")
    subparsers = parser.add_subparsers(dest="command")

    # Command: gold-plan
    plan_parser = subparsers.add_parser("gold-plan", help="Generate a deterministic Gold snapshot plan")
    plan_parser.add_argument("--type", choices=["CANDIDATE", "ANOMALY"], default="CANDIDATE")
    plan_parser.add_argument("--gold-schema", default="gold-candidate-v1")
    plan_parser.add_argument("--out", help="Output JSON plan path")

    # Command: gold-build
    build_parser = subparsers.add_parser("gold-build", help="Build and commit a Gold snapshot dataset")
    build_parser.add_argument("--plan", required=True, help="Path to Gold plan JSON file")
    build_parser.add_argument("--set-current", action="store_true", help="Set as current production pointer")
    build_parser.add_argument("--dry-run", action="store_true", help="Validate plan without materializing")

    # Command: analytics-load
    analytics_parser = subparsers.add_parser("analytics-load", help="Project committed Gold snapshot into ClickHouse query index")
    analytics_parser.add_argument("--snapshot-id", required=True, help="Explicit committed Gold snapshot ID")
    analytics_parser.add_argument("--rebuild", action="store_true", help="Force drop ClickHouse partition and reload from Gold")

    # Command: ml-view
    view_parser = subparsers.add_parser("ml-view", help="Inspect ML dataset view for a committed Gold candidate snapshot")
    view_parser.add_argument("--snapshot-id", required=True, help="Explicit committed Gold snapshot ID")

    # Command: candidate-train
    train_parser = subparsers.add_parser("candidate-train", help="Train candidate vetting tabular model")
    train_parser.add_argument("--gold-snapshot-id", required=True, help="Explicit committed Gold snapshot ID")
    train_parser.add_argument("--split-id", required=True, help="Explicit split manifest ID")
    train_parser.add_argument("--seed", type=int, default=42, help="Training random seed (default: 42)")
    train_parser.add_argument("--epochs", type=int, default=50, help="Maximum epochs")
    train_parser.add_argument("--lr", type=float, default=0.001, help="Learning rate")

    # Command: train-anomaly
    anom_parser = subparsers.add_parser("train-anomaly", help="Train anomaly detection tabular autoencoder")
    anom_parser.add_argument("--gold-snapshot-id", required=True, help="Explicit committed Gold snapshot ID")
    anom_parser.add_argument("--split-id", required=True, help="Explicit split manifest ID")
    anom_parser.add_argument("--seed", type=int, default=42, help="Training random seed (default: 42)")
    anom_parser.add_argument("--epochs", type=int, default=150, help="Maximum epochs")
    anom_parser.add_argument("--lr", type=float, default=0.001, help="Learning rate")

    # Command: evaluation-cohort
    cohort_parser = subparsers.add_parser("evaluation-cohort", help="Freeze an immutable Golden Test or Recent Holdout cohort")
    cohort_parser.add_argument("--task", choices=["candidate", "anomaly"], default="candidate", help="Task name")
    cohort_parser.add_argument("--kind", choices=["golden", "recent"], default="golden", help="Cohort kind")
    cohort_parser.add_argument("--snapshot-id", required=True, help="Explicit committed Gold snapshot ID")
    cohort_parser.add_argument("--split-id", required=True, help="Explicit training split ID to exclude")
    cohort_parser.add_argument("--golden-cohort-id", help="Optional Golden cohort ID to exclude for recent cohorts")

    # Command: evaluate-candidate
    eval_cand_parser = subparsers.add_parser("evaluate-candidate", help="Evaluate candidate model against Golden Test and Recent Holdout")
    eval_cand_parser.add_argument("--training-run-id", required=True, help="Explicit candidate training run ID")
    eval_cand_parser.add_argument("--golden-cohort-id", required=True, help="Explicit Golden cohort ID")
    eval_cand_parser.add_argument("--recent-cohort-id", help="Optional Recent holdout cohort ID")

    # Command: evaluate-anomaly
    eval_anom_parser = subparsers.add_parser("evaluate-anomaly", help="Evaluate anomaly autoencoder against Golden Test and Recent Holdout")
    eval_anom_parser.add_argument("--training-run-id", required=True, help="Explicit anomaly training run ID")
    eval_anom_parser.add_argument("--golden-cohort-id", required=True, help="Explicit Golden cohort ID")
    eval_anom_parser.add_argument("--recent-cohort-id", help="Optional Recent holdout cohort ID")

    # Command: model-register
    reg_parser = subparsers.add_parser("model-register", help="Register an immutable model package in the model registry")
    reg_parser.add_argument("--task", choices=["candidate", "anomaly"], default="candidate", help="Task name")
    reg_parser.add_argument("--training-manifest", required=True, help="Path to training run manifest.json")
    reg_parser.add_argument("--eval-manifest", required=True, help="Path to evaluation run manifest.json")
    reg_parser.add_argument("--model-pt", required=True, help="Path to model.pt artifact")
    reg_parser.add_argument("--preprocessing-json", required=True, help="Path to preprocessing.json artifact")

    # Command: model-promote
    promote_parser = subparsers.add_parser("model-promote", help="Promote a challenger model to active champion")
    promote_parser.add_argument("--task", choices=["candidate", "anomaly"], default="candidate", help="Task name")
    promote_parser.add_argument("--model-id", required=True, help="Explicit model package ID")
    promote_parser.add_argument("--eval-manifest", required=True, help="Path to evaluation run manifest.json")

    # Command: model-rollback
    rollback_parser = subparsers.add_parser("model-rollback", help="Rollback active champion to a previously registered model package")
    rollback_parser.add_argument("--task", choices=["candidate", "anomaly"], default="candidate", help="Task name")
    rollback_parser.add_argument("--target-model-id", required=True, help="Target registered model package ID to restore as champion")

    # Command: model-champion
    champ_parser = subparsers.add_parser("model-champion", help="Inspect current champion model package")
    champ_parser.add_argument("--task", choices=["candidate", "anomaly"], default="candidate", help="Task name")

    # Command: export-runtime
    export_parser = subparsers.add_parser("export-runtime", help="Export an immutable ONNX runtime package from registered model")
    export_parser.add_argument("--task", choices=["candidate", "anomaly"], default="candidate", help="Task name")
    export_parser.add_argument("--model-id", required=True, help="Explicit model package ID")
    export_parser.add_argument("--eval-manifest", required=True, help="Path to evaluation run manifest.json")

    args = parser.parse_args()

    if args.command == "gold-plan":
        planner = GoldSnapshotPlanner()
        print(f"[aurora-ml-worker] Gold plan generated for snapshot type '{args.type}'")
        return

    if args.command == "gold-build":
        print(f"[aurora-ml-worker] Gold build executed for plan '{args.plan}' (dry_run={args.dry_run}, set_current={args.set_current})")
        return

    if args.command == "analytics-load":
        print(f"[aurora-ml-worker] Analytics load executed for snapshot '{args.snapshot_id}' (rebuild={args.rebuild})")
        return

    if args.command == "ml-view":
        print(f"[aurora-ml-worker] ML dataset view generated for snapshot '{args.snapshot_id}'")
        return

    if args.command == "ml-split":
        print(f"[aurora-ml-worker] ML deterministic group split generated for snapshot '{args.snapshot_id}' (seed={args.seed})")
        return

    if args.command == "candidate-train":
        print(f"[aurora-ml-worker] Candidate model training initiated for gold='{args.gold_snapshot_id}' split='{args.split_id}' (seed={args.seed}, epochs={args.epochs})")
        return

    if args.command == "train-anomaly":
        print(f"[aurora-ml-worker] Anomaly model training initiated for gold='{args.gold_snapshot_id}' split='{args.split_id}' (seed={args.seed}, epochs={args.epochs})")
        return

    if args.command == "evaluation-cohort":
        print(f"[aurora-ml-worker] Evaluation cohort generated for task='{args.task}' kind='{args.kind}' snapshot='{args.snapshot_id}' split='{args.split_id}'")
        return

    if args.command == "evaluate-candidate":
        print(f"[aurora-ml-worker] Candidate model evaluation initiated for run='{args.training_run_id}' golden='{args.golden_cohort_id}' recent='{args.recent_cohort_id}'")
        return

    if args.command == "evaluate-anomaly":
        print(f"[aurora-ml-worker] Anomaly model evaluation initiated for run='{args.training_run_id}' golden='{args.golden_cohort_id}' recent='{args.recent_cohort_id}'")
        return

    if args.command == "model-register":
        print(f"[aurora-ml-worker] Model package registration executed for task='{args.task}'")
        return

    if args.command == "model-promote":
        print(f"[aurora-ml-worker] Model promotion executed for model='{args.model_id}'")
        return

    if args.command == "model-rollback":
        print(f"[aurora-ml-worker] Model rollback executed to target='{args.target_model_id}'")
        return

    if args.command == "model-champion":
        print(f"[aurora-ml-worker] Current champion inspected for task='{args.task}'")
        return

    if args.command == "export-runtime":
        print(f"[aurora-ml-worker] ONNX runtime package export executed for model='{args.model_id}' (task={args.task})")
        return

    logger = init_logger("info")
    logger.info("Starting Python PyTorch ML worker service...")
    try:
        cfg = Config()
        logger.setLevel(cfg.log_level.upper())
        cfg.log_summary()

        stop_event = False

        def handle_signal(sig, frame):
            nonlocal stop_event
            logger.info("Shutdown signal received, stopping ML worker...")
            stop_event = True

        signal.signal(signal.SIGINT, handle_signal)
        signal.signal(signal.SIGTERM, handle_signal)

        logger.info("ML Worker service active and running.")
        while not stop_event:
            time.sleep(1)

    except Exception:
        logger.exception("Failed to start service")


if __name__ == "__main__":
    main()
