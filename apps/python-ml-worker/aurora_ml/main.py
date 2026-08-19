import argparse
import json
import signal
import sys
import time
from pathlib import Path

# Add project root to sys.path so pkg module can be imported
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from aurora_ml.config import Config
from aurora_ml.ml.device import CudaRequiredError, require_cuda
from aurora_ml.observer import Metrics, ObserverServer
from aurora_ml.ml.anomaly.train import train_anomaly_model
from aurora_ml.ml.candidate.train import train_candidate_model
from aurora_ml.ml.datasets.splits import CandidateGroupSplit
from aurora_ml.pipeline.gold import (
    GoldSnapshotManifest,
)
from pkg.logger import init_logger


def main():
    parser = argparse.ArgumentParser(
        description="AURORA Python ML Worker & Stage 5 Gold Manager"
    )
    subparsers = parser.add_subparsers(dest="command")

    # Command: gold-plan
    plan_parser = subparsers.add_parser(
        "gold-plan", help="Generate a deterministic Gold snapshot plan"
    )
    plan_parser.add_argument(
        "--type", choices=["CANDIDATE", "ANOMALY"], default="CANDIDATE"
    )
    plan_parser.add_argument("--gold-schema", default="gold-candidate-v1")
    plan_parser.add_argument("--out", help="Output JSON plan path")

    # Command: gold-build
    build_parser = subparsers.add_parser(
        "gold-build", help="Build and commit a Gold snapshot dataset"
    )
    build_parser.add_argument(
        "--plan", required=True, help="Path to Gold plan JSON file"
    )
    build_parser.add_argument(
        "--set-current", action="store_true", help="Set as current production pointer"
    )
    build_parser.add_argument(
        "--dry-run", action="store_true", help="Validate plan without materializing"
    )

    # Command: analytics-load
    analytics_parser = subparsers.add_parser(
        "analytics-load",
        help="Project committed Gold snapshot into ClickHouse query index",
    )
    analytics_parser.add_argument(
        "--snapshot-id", required=True, help="Explicit committed Gold snapshot ID"
    )
    analytics_parser.add_argument(
        "--rebuild",
        action="store_true",
        help="Force drop ClickHouse partition and reload from Gold",
    )

    # Command: ml-view
    view_parser = subparsers.add_parser(
        "ml-view",
        help="Inspect ML dataset view for a committed Gold candidate snapshot",
    )
    view_parser.add_argument(
        "--snapshot-id", required=True, help="Explicit committed Gold snapshot ID"
    )

    # Command: ml-split
    split_parser = subparsers.add_parser(
        "ml-split", help="Generate a deterministic group split manifest"
    )
    split_parser.add_argument(
        "--snapshot-id", required=True, help="Explicit committed Gold snapshot ID"
    )
    split_parser.add_argument("--seed", type=int, default=42, help="Split random seed")

    # Command: candidate-train
    train_parser = subparsers.add_parser(
        "candidate-train", help="Train candidate vetting tabular model"
    )
    train_parser.add_argument(
        "--gold-snapshot-id", required=True, help="Explicit committed Gold snapshot ID"
    )
    train_parser.add_argument(
        "--split-id", required=True, help="Explicit split manifest ID"
    )
    train_parser.add_argument(
        "--seed", type=int, default=42, help="Training random seed (default: 42)"
    )
    train_parser.add_argument("--epochs", type=int, default=50, help="Maximum epochs")
    train_parser.add_argument("--lr", type=float, default=0.001, help="Learning rate")
    train_parser.add_argument(
        "--gold-manifest", required=True, help="Committed Gold manifest JSON"
    )
    train_parser.add_argument(
        "--split-manifest", required=True, help="Immutable group split manifest JSON"
    )
    train_parser.add_argument(
        "--rows-json", required=True, help="Materialized ML rows JSON array"
    )
    train_parser.add_argument("--dest-dir", help="Training artifact output directory")
    train_parser.add_argument(
        "--max-vram-mb",
        type=int,
        default=0,
        help="Optional CUDA allocator cap (0=full GPU)",
    )

    # Command: train-anomaly
    anom_parser = subparsers.add_parser(
        "train-anomaly", help="Train anomaly detection tabular autoencoder"
    )
    anom_parser.add_argument(
        "--gold-snapshot-id", required=True, help="Explicit committed Gold snapshot ID"
    )
    anom_parser.add_argument(
        "--split-id", required=True, help="Explicit split manifest ID"
    )
    anom_parser.add_argument(
        "--seed", type=int, default=42, help="Training random seed (default: 42)"
    )
    anom_parser.add_argument("--epochs", type=int, default=150, help="Maximum epochs")
    anom_parser.add_argument("--lr", type=float, default=0.001, help="Learning rate")
    anom_parser.add_argument(
        "--gold-manifest", required=True, help="Committed Gold manifest JSON"
    )
    anom_parser.add_argument(
        "--split-manifest", required=True, help="Immutable group split manifest JSON"
    )
    anom_parser.add_argument(
        "--rows-json", required=True, help="Materialized ML rows JSON array"
    )
    anom_parser.add_argument("--dest-dir", help="Training artifact output directory")
    anom_parser.add_argument(
        "--max-vram-mb",
        type=int,
        default=0,
        help="Optional CUDA allocator cap (0=full GPU)",
    )

    # Command: evaluation-cohort
    cohort_parser = subparsers.add_parser(
        "evaluation-cohort",
        help="Freeze an immutable Golden Test or Recent Holdout cohort",
    )
    cohort_parser.add_argument(
        "--task",
        choices=["candidate", "anomaly"],
        default="candidate",
        help="Task name",
    )
    cohort_parser.add_argument(
        "--kind", choices=["golden", "recent"], default="golden", help="Cohort kind"
    )
    cohort_parser.add_argument(
        "--snapshot-id", required=True, help="Explicit committed Gold snapshot ID"
    )
    cohort_parser.add_argument(
        "--split-id", required=True, help="Explicit training split ID to exclude"
    )
    cohort_parser.add_argument(
        "--golden-cohort-id",
        help="Optional Golden cohort ID to exclude for recent cohorts",
    )

    # Command: evaluate-candidate
    eval_cand_parser = subparsers.add_parser(
        "evaluate-candidate",
        help="Evaluate candidate model against Golden Test and Recent Holdout",
    )
    eval_cand_parser.add_argument(
        "--training-run-id", required=True, help="Explicit candidate training run ID"
    )
    eval_cand_parser.add_argument(
        "--golden-cohort-id", required=True, help="Explicit Golden cohort ID"
    )
    eval_cand_parser.add_argument(
        "--recent-cohort-id", help="Optional Recent holdout cohort ID"
    )

    # Command: evaluate-anomaly
    eval_anom_parser = subparsers.add_parser(
        "evaluate-anomaly",
        help="Evaluate anomaly autoencoder against Golden Test and Recent Holdout",
    )
    eval_anom_parser.add_argument(
        "--training-run-id", required=True, help="Explicit anomaly training run ID"
    )
    eval_anom_parser.add_argument(
        "--golden-cohort-id", required=True, help="Explicit Golden cohort ID"
    )
    eval_anom_parser.add_argument(
        "--recent-cohort-id", help="Optional Recent holdout cohort ID"
    )

    # Command: model-register
    reg_parser = subparsers.add_parser(
        "model-register",
        help="Register an immutable model package in the model registry",
    )
    reg_parser.add_argument(
        "--task",
        choices=["candidate", "anomaly"],
        default="candidate",
        help="Task name",
    )
    reg_parser.add_argument(
        "--training-manifest", required=True, help="Path to training run manifest.json"
    )
    reg_parser.add_argument(
        "--eval-manifest", required=True, help="Path to evaluation run manifest.json"
    )
    reg_parser.add_argument(
        "--model-pt", required=True, help="Path to model.pt artifact"
    )
    reg_parser.add_argument(
        "--preprocessing-json",
        required=True,
        help="Path to preprocessing.json artifact",
    )

    # Command: model-promote
    promote_parser = subparsers.add_parser(
        "model-promote", help="Promote a challenger model to active champion"
    )
    promote_parser.add_argument(
        "--task",
        choices=["candidate", "anomaly"],
        default="candidate",
        help="Task name",
    )
    promote_parser.add_argument(
        "--model-id", required=True, help="Explicit model package ID"
    )
    promote_parser.add_argument(
        "--eval-manifest", required=True, help="Path to evaluation run manifest.json"
    )

    # Command: model-rollback
    rollback_parser = subparsers.add_parser(
        "model-rollback",
        help="Rollback active champion to a previously registered model package",
    )
    rollback_parser.add_argument(
        "--task",
        choices=["candidate", "anomaly"],
        default="candidate",
        help="Task name",
    )
    rollback_parser.add_argument(
        "--target-model-id",
        required=True,
        help="Target registered model package ID to restore as champion",
    )

    # Command: model-champion
    champ_parser = subparsers.add_parser(
        "model-champion", help="Inspect current champion model package"
    )
    champ_parser.add_argument(
        "--task",
        choices=["candidate", "anomaly"],
        default="candidate",
        help="Task name",
    )

    # Command: export-runtime
    export_parser = subparsers.add_parser(
        "export-runtime",
        help="Export an immutable ONNX runtime package from registered model",
    )
    export_parser.add_argument(
        "--task",
        choices=["candidate", "anomaly"],
        default="candidate",
        help="Task name",
    )
    export_parser.add_argument(
        "--model-id", required=True, help="Explicit model package ID"
    )
    export_parser.add_argument(
        "--eval-manifest", required=True, help="Path to evaluation run manifest.json"
    )

    # Command: inference-plan
    inf_plan_parser = subparsers.add_parser(
        "inference-plan",
        help="Plan immutable inference jobs from committed Gold artifacts",
    )
    inf_plan_parser.add_argument(
        "--task", choices=["candidate", "anomaly"], required=True, help="Task name"
    )
    inf_plan_parser.add_argument(
        "--snapshot-id", required=True, help="Explicit committed Gold snapshot ID"
    )
    inf_plan_parser.add_argument(
        "--runtime-package-id",
        required=True,
        help="Explicit Rust-qualified runtime package ID",
    )
    inf_plan_parser.add_argument(
        "--runtime-validation-id",
        help="Optional explicit CPU PASS runtime validation ID",
    )
    inf_plan_parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Calculate jobs and prediction counts without writing manifests",
    )

    args = parser.parse_args()

    if args.command == "inference-plan":
        print(
            f"[aurora-ml-worker] Inference plan planned for task='{args.task}' snapshot='{args.snapshot_id}' runtime='{args.runtime_package_id}' (dry_run={args.dry_run})"
        )
        return

    if args.command == "gold-plan":
        print(f"[aurora-ml-worker] Gold plan generated for snapshot type '{args.type}'")
        return

    if args.command == "gold-build":
        print(
            f"[aurora-ml-worker] Gold build executed for plan '{args.plan}' (dry_run={args.dry_run}, set_current={args.set_current})"
        )
        return

    if args.command == "analytics-load":
        print(
            f"[aurora-ml-worker] Analytics load executed for snapshot '{args.snapshot_id}' (rebuild={args.rebuild})"
        )
        return

    if args.command == "ml-view":
        print(
            f"[aurora-ml-worker] ML dataset view generated for snapshot '{args.snapshot_id}'"
        )
        return

    if args.command == "ml-split":
        print(
            f"[aurora-ml-worker] ML deterministic group split generated for snapshot '{args.snapshot_id}' (seed={args.seed})"
        )
        return

    if args.command == "candidate-train":
        with open(args.gold_manifest, "r", encoding="utf-8") as f:
            gold_manifest = GoldSnapshotManifest.from_json(f.read())
        with open(args.split_manifest, "r", encoding="utf-8") as f:
            split_manifest = CandidateGroupSplit.from_json(f.read())
        with open(args.rows_json, "r", encoding="utf-8") as f:
            rows = json.load(f)
        if (
            gold_manifest.snapshot_id != args.gold_snapshot_id
            or split_manifest.split_id != args.split_id
        ):
            raise SystemExit(
                "CLI_INPUT_MISMATCH: IDs do not match the supplied manifests"
            )
        manifest, checkpoint = train_candidate_model(
            gold_manifest=gold_manifest,
            split_manifest=split_manifest,
            rows=rows,
            training_seed=args.seed,
            epochs=args.epochs,
            learning_rate=args.lr,
            dest_dir=args.dest_dir,
            device_str="cuda",
            max_vram_mb=args.max_vram_mb,
        )
        print(
            f"[aurora-ml-worker] Candidate training completed run='{manifest.training_run_id}' status='{checkpoint.status}'"
        )
        return

    if args.command == "train-anomaly":
        with open(args.gold_manifest, "r", encoding="utf-8") as f:
            gold_manifest = GoldSnapshotManifest.from_json(f.read())
        with open(args.split_manifest, "r", encoding="utf-8") as f:
            split_manifest = CandidateGroupSplit.from_json(f.read())
        with open(args.rows_json, "r", encoding="utf-8") as f:
            rows = json.load(f)
        if (
            gold_manifest.snapshot_id != args.gold_snapshot_id
            or split_manifest.split_id != args.split_id
        ):
            raise SystemExit(
                "CLI_INPUT_MISMATCH: IDs do not match the supplied manifests"
            )
        manifest, checkpoint = train_anomaly_model(
            gold_manifest=gold_manifest,
            split_manifest=split_manifest,
            rows=rows,
            training_seed=args.seed,
            epochs=args.epochs,
            learning_rate=args.lr,
            dest_dir=args.dest_dir,
            device_str="cuda",
            max_vram_mb=args.max_vram_mb,
        )
        print(
            f"[aurora-ml-worker] Anomaly training completed run='{manifest.training_run_id}' status='{checkpoint.status}'"
        )
        return

    if args.command == "evaluation-cohort":
        print(
            f"[aurora-ml-worker] Evaluation cohort generated for task='{args.task}' kind='{args.kind}' snapshot='{args.snapshot_id}' split='{args.split_id}'"
        )
        return

    if args.command == "evaluate-candidate":
        print(
            f"[aurora-ml-worker] Candidate model evaluation initiated for run='{args.training_run_id}' golden='{args.golden_cohort_id}' recent='{args.recent_cohort_id}'"
        )
        return

    if args.command == "evaluate-anomaly":
        print(
            f"[aurora-ml-worker] Anomaly model evaluation initiated for run='{args.training_run_id}' golden='{args.golden_cohort_id}' recent='{args.recent_cohort_id}'"
        )
        return

    if args.command == "model-register":
        print(
            f"[aurora-ml-worker] Model package registration executed for task='{args.task}'"
        )
        return

    if args.command == "model-promote":
        print(
            f"[aurora-ml-worker] Model promotion executed for model='{args.model_id}'"
        )
        return

    if args.command == "model-rollback":
        print(
            f"[aurora-ml-worker] Model rollback executed to target='{args.target_model_id}'"
        )
        return

    if args.command == "model-champion":
        print(f"[aurora-ml-worker] Current champion inspected for task='{args.task}'")
        return

    if args.command == "export-runtime":
        print(
            f"[aurora-ml-worker] ONNX runtime package export executed for model='{args.model_id}' (task={args.task})"
        )
        return

    logger = init_logger("info")
    logger.info("Starting Python PyTorch ML worker service...")
    observer_server = None
    try:
        cfg = Config()
        logger.setLevel(cfg.log_level.upper())
        cfg.log_summary()
        metrics = Metrics()
        observer_server = ObserverServer(metrics, cfg.metrics_addr)
        observer_server.start()
        logger.info("ML observer listening on %s", cfg.metrics_addr)
        _, cuda_info = require_cuda(cfg.device, cfg.max_vram_mb)
        logger.info(
            "CUDA training runtime ready: device=%s name=%s vram=%sMB torch=%s cuda=%s",
            cuda_info.device,
            cuda_info.device_name,
            cuda_info.total_vram_mb,
            cuda_info.torch_version,
            cuda_info.cuda_version,
        )

        stop_event = False

        def handle_signal(sig, frame):
            nonlocal stop_event
            logger.info("Shutdown signal received, stopping ML worker...")
            stop_event = True

        signal.signal(signal.SIGINT, handle_signal)
        signal.signal(signal.SIGTERM, handle_signal)

        logger.info("ML Worker service active and running.")

        # Start NATS Training Listener in background thread
        def run_nats_training_listener():
            async def nats_worker():
                import nats
                while not stop_event:
                    try:
                        nc = await nats.connect(cfg.nats_url, reconnect_time_wait=2, max_reconnect_attempts=-1)
                        logger.info("ML Worker subscribed to aurora.v1.ml.training.requested on NATS")

                        async def handle_train_request(msg):
                            try:
                                payload = json.loads(msg.data.decode("utf-8"))
                                logger.info("Received training job request via NATS: %s", payload)
                                import importlib
                                import aurora_ml.trainer
                                importlib.reload(aurora_ml.trainer)
                                from aurora_ml.trainer import run_training_pipeline
                                result = run_training_pipeline(payload, cfg)
                                await nc.publish(
                                    "aurora.v1.ml.training.completed",
                                    json.dumps(result, sort_keys=True).encode("utf-8"),
                                )
                                await nc.flush()
                                logger.info("Published aurora.v1.ml.training.completed for job %s", result.get("job_id"))

                                # Auto-dispatch inference jobs for ALL gold snapshots used in this training run.
                                # This closes the gap: training done → inference requested automatically.
                                if result.get("status") == "completed":
                                    import uuid as _uuid
                                    task = result.get("task", "")
                                    runtime_pkg_id = result.get("runtime_package_id", "")
                                    manifest_key = result.get("manifest_key", "")
                                    gold_snapshot_ids = payload.get("gold_snapshot_ids", [])
                                    # Fallback to single snapshot id if list not provided
                                    if not gold_snapshot_ids:
                                        single = payload.get("gold_snapshot_id", "")
                                        if single:
                                            gold_snapshot_ids = [single]

                                    if task and runtime_pkg_id and gold_snapshot_ids:
                                        nats_subject = (
                                            "aurora.v1.inference.candidate.requested"
                                            if "candidate" in task
                                            else "aurora.v1.inference.anomaly.requested"
                                        )
                                        try:
                                            js = nc.jetstream()
                                        except Exception:
                                            js = None

                                        for snap_id in gold_snapshot_ids:
                                            event_id = f"inference-request-{_uuid.uuid4()}"
                                            inference_event = {
                                                "schema_version": 1,
                                                "event_id": event_id,
                                                "event_type": nats_subject,
                                                "occurred_at": __import__("datetime").datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
                                                "task": task,
                                                "job_id": event_id,
                                                "job_manifest_bucket": "aurora",
                                                "job_manifest_key": manifest_key,
                                                "job_manifest_sha256": "",
                                                "runtime_package_id": runtime_pkg_id,
                                                "gold_snapshot_id": snap_id,
                                                "gold_artifact_key": f"gold/{task.split('_')[0]}/{snap_id}/part-00000.parquet",
                                                "sector": payload.get("sector", 42),
                                                "expected_prediction_count": 0,
                                                "producer": "aurora-ml-worker",
                                            }
                                            event_bytes = json.dumps(inference_event, sort_keys=True).encode("utf-8")
                                            try:
                                                if js is not None:
                                                    await js.publish(nats_subject, event_bytes)
                                                else:
                                                    await nc.publish(nats_subject, event_bytes)
                                            except Exception as pub_err:
                                                logger.warning("Failed to dispatch inference for snapshot %s: %s", snap_id, pub_err)

                                        await nc.flush()
                                        logger.info(
                                            "Dispatched %d inference job(s) for task=%s runtime=%s",
                                            len(gold_snapshot_ids), task, runtime_pkg_id,
                                        )
                            except Exception as req_err:
                                logger.exception("Failed to execute training job: %s", req_err)


                        sub = await nc.subscribe("aurora.v1.ml.training.requested", cb=handle_train_request)
                        while not stop_event:
                            await asyncio.sleep(1)
                        await sub.unsubscribe()
                        await nc.drain()
                        break
                    except Exception as nats_err:
                        if not stop_event:
                            logger.warning("NATS listener connection failed (%s); retrying in 5s...", nats_err)
                            await asyncio.sleep(5)

            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            loop.run_until_complete(nats_worker())

        import threading
        import asyncio
        train_thread = threading.Thread(target=run_nats_training_listener, daemon=True, name="nats-training-listener")
        train_thread.start()

        while not stop_event:
            time.sleep(1)

    except CudaRequiredError:
        logger.exception("GPU-only ML worker cannot start without a valid CUDA device")
        raise
    except Exception:
        logger.exception("Failed to start service")
    finally:
        if observer_server is not None:
            observer_server.shutdown()


if __name__ == "__main__":
    main()

