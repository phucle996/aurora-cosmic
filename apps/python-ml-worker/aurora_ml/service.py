"""Long-running ML worker service. The dashboard/API is its control plane."""

from __future__ import annotations

import asyncio
import json
import logging
import signal
from typing import Any

import nats
from nats.js.api import AckPolicy, ConsumerConfig, DeliverPolicy, StreamConfig

from aurora_ml.application.training import TrainingApplication
from aurora_ml.config import Config
from aurora_ml.domain.training import TrainingRequest
from aurora_ml.observer import Metrics, ObserverServer
from pkg.logger import init_logger

LOGGER = logging.getLogger("aurora-ml-service")
REQUEST_SUBJECT = "aurora.v1.ml.training.requested"
COMPLETED_SUBJECT = "aurora.v1.ml.training.completed"
FAILED_SUBJECT = "aurora.v1.ml.training.failed"
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
                # Observation must never invalidate an otherwise reproducible run.
                LOGGER.warning(
                    "Unable to publish training progress for %s",
                    value.get("job_id", ""),
                    exc_info=True,
                )

        application = TrainingApplication(config, progress=report_progress)
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
                            "job_id": request.job_id,
                            "task": request.task,
                            "status": "running",
                            "phase": "worker_acknowledged",
                            "progress_percent": 2,
                        },
                    )
                    with metrics.job("training"):
                        result = await asyncio.to_thread(application.execute, request)
                    await _publish(nc, COMPLETED_SUBJECT, result)
                    for inference_request in result.get("inference_requests", []):
                        await nc.jetstream().publish(
                            inference_request["event_type"],
                            json.dumps(inference_request, sort_keys=True).encode(),
                        )
                    await message.ack()
                except Exception as exc:
                    failure = {
                        "schema_version": 1,
                        "job_id": str(payload.get("training_job_id", "")),
                        "task": str(payload.get("task", "")),
                        "status": "failed",
                        "error_code": type(exc).__name__,
                        "error": str(exc),
                    }
                    LOGGER.exception("ML training job failed: %s", failure["job_id"])
                    await _publish(nc, FAILED_SUBJECT, failure)
                    # The application journals failures. Ack prevents an invalid
                    # scientific request from hot-looping until a human retries it.
                    await message.ack()
    finally:
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
