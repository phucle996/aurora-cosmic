"""Small Prometheus observer for the ML worker.

Labels are deliberately bounded: model IDs, snapshot IDs, paths, and request
IDs must never become Prometheus labels.
"""

from __future__ import annotations

import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from typing import Any

from prometheus_client import (
    CONTENT_TYPE_LATEST,
    CollectorRegistry,
    Counter,
    Gauge,
    Histogram,
    generate_latest,
)


_OPERATIONS = frozenset({"training", "inference", "evaluation", "export", "gold", "other"})
_STATUSES = frozenset({"success", "failed", "skipped"})


def _operation(value: str) -> str:
    return value if value in _OPERATIONS else "other"


def _status(value: str) -> str:
    return value if value in _STATUSES else "failed"


class Metrics:
    """Own the worker registry and expose seven low-cardinality metric families."""

    def __init__(self) -> None:
        self.registry = CollectorRegistry(auto_describe=True)
        self.jobs = Counter(
            "aurora_ml_jobs_total",
            "ML jobs completed by operation and terminal status.",
            ["operation", "status"],
            registry=self.registry,
        )
        self.duration = Histogram(
            "aurora_ml_job_duration_seconds",
            "ML job wall-clock duration in seconds.",
            ["operation"],
            registry=self.registry,
        )
        self.errors = Counter(
            "aurora_ml_errors_total",
            "ML job failures by bounded operation.",
            ["operation"],
            registry=self.registry,
        )
        self.inflight = Gauge(
            "aurora_ml_inflight_jobs",
            "ML jobs currently executing.",
            registry=self.registry,
        )
        self.queue_depth = Gauge(
            "aurora_ml_queue_depth",
            "Jobs waiting for an ML worker.",
            registry=self.registry,
        )
        self.rows = Counter(
            "aurora_ml_rows_processed_total",
            "Rows successfully processed by operation.",
            ["operation"],
            registry=self.registry,
        )
        self.last_success = Gauge(
            "aurora_ml_last_success_timestamp_seconds",
            "Unix timestamp of the last successful ML job.",
            registry=self.registry,
        )
        self.queue_depth.set(0)

    def job(self, operation: str, rows: int = 0) -> JobObservation:
        """Return a context manager that records one terminal job outcome."""

        return JobObservation(self, _operation(operation), rows)

    def set_queue_depth(self, depth: int) -> None:
        self.queue_depth.set(max(0, depth))


class JobObservation:
    """RAII-style accounting so every job is recorded exactly once."""

    def __init__(self, metrics: Metrics, operation: str, rows: int = 0) -> None:
        self._metrics = metrics
        self._operation = operation
        self._rows = max(0, rows)
        self._status = "success"
        self._started = 0.0

    def set_status(self, status: str) -> None:
        self._status = _status(status)

    def set_rows(self, rows: int) -> None:
        self._rows = max(0, rows)

    def __enter__(self) -> JobObservation:
        self._started = time.monotonic()
        self._metrics.inflight.inc()
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: Any,
    ) -> bool:
        status = "failed" if exc_type is not None else _status(self._status)
        if status == "failed":
            self._metrics.errors.labels(operation=self._operation).inc()
        self._metrics.jobs.labels(operation=self._operation, status=status).inc()
        self._metrics.duration.labels(operation=self._operation).observe(
            max(0.0, time.monotonic() - self._started)
        )
        if status == "success":
            if self._rows:
                self._metrics.rows.labels(operation=self._operation).inc(self._rows)
            self._metrics.last_success.set(time.time())
        self._metrics.inflight.dec()
        return False


def _handler(metrics: Metrics) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - stdlib handler API
            if self.path == "/healthz":
                body = b"ok\n"
                content_type = "text/plain; version=0.0.4"
                status = 200
            elif self.path == "/metrics":
                body = generate_latest(metrics.registry)
                content_type = CONTENT_TYPE_LATEST
                status = 200
            else:
                body = b"not found\n"
                content_type = "text/plain; charset=utf-8"
                status = 404
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format: str, *args: Any) -> None:
            return

    return Handler


def _address(value: str) -> tuple[str, int]:
    host, separator, port = value.rpartition(":")
    if not separator or not port:
        raise ValueError(f"invalid metrics address {value!r}; expected HOST:PORT")
    return host or "0.0.0.0", int(port)


class ObserverServer:
    """Background HTTP server for /metrics and /healthz."""

    def __init__(self, metrics: Metrics, address: str) -> None:
        self._metrics = metrics
        self._address = address
        self._server: ThreadingHTTPServer | None = None
        self._thread: Thread | None = None

    def start(self) -> None:
        if self._server is not None:
            return
        self._server = ThreadingHTTPServer(_address(self._address), _handler(self._metrics))
        self._thread = Thread(target=self._server.serve_forever, name="ml-observer", daemon=True)
        self._thread.start()

    def shutdown(self) -> None:
        server = self._server
        if server is None:
            return
        server.shutdown()
        server.server_close()
        if self._thread is not None:
            self._thread.join(timeout=2)
        self._server = None
        self._thread = None
