"""Long-running ML worker service. The dashboard/API is its control plane."""

from __future__ import annotations

import asyncio
import json
import logging
import signal
from typing import Any

import nats
from nats.js.api import AckPolicy, ConsumerConfig, DeliverPolicy, StreamConfig

from config import Config
from logger import init_logger
from metrics import Metrics, ObserverServer
from train import TrainingApplication, TrainingRequest

LOGGER = logging.getLogger("aurora-ml-service")
REQUEST_SUBJECT = "aurora.v1.ml.training.requested"
CONTROL_SUBJECT = "aurora.v1.ml.training.control"
COMPLETED_SUBJECT = "aurora.v1.ml.training.completed"
FAILED_SUBJECT = "aurora.v1.ml.training.failed"
CANCELLED_SUBJECT = "aurora.v1.ml.training.cancelled"
LOG_SUBJECT = "aurora.v1.ml.training.log"
PROGRESS_SUBJECT = "aurora.v1.ml.training.progress"
STREAM_NAME = "AURORA_ML"
CONSUMER_NAME = "aurora-ml-worker-v1"


async def _ensure_consumer(js: Any) -> Any:
    try:
        await js.stream_info(STREAM_NAME)
    except Exception:
        await js.add_stream(StreamConfig(name=STREAM_NAME, subjects=["aurora.v1.ml.>"]))
    config = ConsumerConfig(
        durable_name=CONSUMER_NAME,
        ack_policy=AckPolicy.EXPLICIT,
        ack_wait=60 * 60,
        max_deliver=-1,
        deliver_policy=DeliverPolicy.ALL,
    )
    return await js.pull_subscribe(
        REQUEST_SUBJECT, durable=CONSUMER_NAME, config=config
    )


async def _publish(nc: Any, subject: str, value: dict[str, Any]) -> None:
    await nc.publish(subject, json.dumps(value, sort_keys=True).encode())
    await nc.flush()


async def _consume(config: Config, metrics: Metrics, stop: asyncio.Event) -> None:
    nc = await nats.connect(
        config.nats_url, reconnect_time_wait=2, max_reconnect_attempts=-1
    )
    subscription: Any | None = None
    try:
        loop = asyncio.get_running_loop()

        def report_progress(value: dict[str, Any]) -> None:
            try:
                future = asyncio.run_coroutine_threadsafe(
                    _publish(nc, PROGRESS_SUBJECT, value), loop
                )
                future.result(timeout=10)
            except Exception:
                LOGGER.warning(
                    "Unable to publish training progress for %s",
                    value.get("ticket_id", ""),
                    exc_info=True,
                )

        def report_log(ticket_id: str, message: str, level: str = "info") -> None:
            try:
                future = asyncio.run_coroutine_threadsafe(
                    _publish(
                        nc,
                        LOG_SUBJECT,
                        {
                            "schema_version": 1,
                            "ticket_id": ticket_id,
                            "level": level,
                            "message": message,
                        },
                    ),
                    loop,
                )
                future.result(timeout=10)
            except Exception:
                LOGGER.warning(
                    "Unable to publish training log for %s",
                    ticket_id,
                    exc_info=True,
                )

        application = TrainingApplication(
            config, progress=report_progress, logger=report_log
        )
        control_sub = await nc.subscribe(CONTROL_SUBJECT)

        async def _handle_control():
            try:
                async for msg in control_sub.messages:
                    try:
                        raw = json.loads(msg.data.decode("utf-8"))
                        ctrl_ticket_id = str(raw.get("ticket_id", "")).strip()
                        ctrl_action = str(raw.get("action", "")).strip()
                        if ctrl_ticket_id and ctrl_action:
                            LOGGER.info(
                                "ML control signal received: ticket=%s action=%s",
                                ctrl_ticket_id,
                                ctrl_action,
                            )
                            application.set_control(ctrl_ticket_id, ctrl_action)
                    except Exception:
                        LOGGER.warning(
                            "Malformed training control payload", exc_info=True
                        )
            except asyncio.CancelledError:
                pass

        control_task = asyncio.create_task(_handle_control())
        subscription = await _ensure_consumer(nc.jetstream())
        LOGGER.info("ML worker consuming durable JetStream subject %s", REQUEST_SUBJECT)
        while not stop.is_set():
            try:
                messages = await subscription.fetch(1, timeout=1)
            except TimeoutError:
                continue
            for message in messages:
                payload: dict[str, Any] = {}
                try:
                    decoded = json.loads(message.data.decode("utf-8"))
                    if not isinstance(decoded, dict):
                        raise ValueError("training event must be a JSON object")
                    payload = decoded
                    request = TrainingRequest.from_payload(payload)
                    await _publish(
                        nc,
                        PROGRESS_SUBJECT,
                        {
                            "schema_version": 1,
                            "ticket_id": request.ticket_id,
                            "task": request.task,
                            "status": "running",
                            "phase": "worker_acknowledged",
                            "progress_percent": 2,
                        },
                    )
                    await _publish(
                        nc,
                        LOG_SUBJECT,
                        {
                            "schema_version": 1,
                            "ticket_id": request.ticket_id,
                            "level": "info",
                            "message": f"Worker acknowledged training ticket {request.ticket_id} for task {request.task}",
                        },
                    )
                    with metrics.job("training"):
                        result = await asyncio.to_thread(application.execute, request)
                    result["ticket_id"] = request.ticket_id
                    await _publish(nc, COMPLETED_SUBJECT, result)
                    await _publish(
                        nc,
                        LOG_SUBJECT,
                        {
                            "schema_version": 1,
                            "ticket_id": request.ticket_id,
                            "level": "info",
                            "message": f"Training completed successfully. Model registered: {result.get('model_name', '')}",
                        },
                    )
                    await message.ack()
                except Exception as exc:
                    is_cancelled = "CANCELLED" in str(exc).upper()
                    ticket_id = str(payload.get("ticket_id") or "")
                    failure = {
                        "schema_version": 1,
                        "ticket_id": ticket_id,
                        "task": str(payload.get("task", "")),
                        "status": "cancelled" if is_cancelled else "failed",
                        "error_code": type(exc).__name__,
                        "error": str(exc),
                    }
                    if is_cancelled:
                        LOGGER.info(
                            "ML training ticket cancelled by operator: %s", ticket_id
                        )
                        await _publish(nc, CANCELLED_SUBJECT, failure)
                        await _publish(
                            nc,
                            LOG_SUBJECT,
                            {
                                "schema_version": 1,
                                "ticket_id": ticket_id,
                                "level": "warn",
                                "message": f"Training cancelled by operator: {exc}",
                            },
                        )
                    else:
                        LOGGER.exception("ML training job failed: %s", ticket_id)
                        await _publish(nc, FAILED_SUBJECT, failure)
                        await _publish(
                            nc,
                            LOG_SUBJECT,
                            {
                                "schema_version": 1,
                                "ticket_id": ticket_id,
                                "level": "error",
                                "message": f"Training failed: {exc}",
                            },
                        )
                    await message.ack()
    finally:
        if "control_task" in locals() and not control_task.done():
            control_task.cancel()
        if "control_sub" in locals() and control_sub is not None:
            await control_sub.unsubscribe()
        if subscription is not None:
            await subscription.unsubscribe()
        await nc.flush()
        await nc.close()


async def _refresh_hardware(metrics: Metrics, stop: asyncio.Event) -> None:
    while not stop.is_set():
        metrics.refresh_hardware()
        try:
            await asyncio.wait_for(stop.wait(), timeout=1)
        except TimeoutError:
            pass


async def run_worker(config: Config) -> None:
    metrics = Metrics()
    observer = ObserverServer(metrics, config.metrics_addr)
    observer.start()
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for signal_type in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(signal_type, stop.set)
    try:
        async with asyncio.TaskGroup() as group:
            group.create_task(_consume(config, metrics, stop))
            group.create_task(_refresh_hardware(metrics, stop))
            await stop.wait()
    finally:
        observer.shutdown()


def main() -> None:
    logger = init_logger("info")
    config = Config()
    logger.setLevel(config.log_level.upper())
    config.log_summary()
    asyncio.run(run_worker(config))


if __name__ == "__main__":
    main()
