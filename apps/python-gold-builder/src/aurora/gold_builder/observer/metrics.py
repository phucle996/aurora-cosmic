"""Low-cardinality Prometheus metrics for durable Gold materialization."""

from __future__ import annotations

from prometheus_client import CollectorRegistry, Counter, Gauge, Histogram
from prometheus_client.exposition import start_http_server

_STATUSES = ("success", "failed", "deferred")


class Metrics:
    """Own the Gold Builder metric registry and bounded signal contract."""

    def __init__(self) -> None:
        self.registry = CollectorRegistry(auto_describe=True)
        self.batches = Counter(
            "aurora_gold_batches_total",
            "Gold build attempts reaching a terminal outcome.",
            ["status"],
            registry=self.registry,
        )
        self.duration = Histogram(
            "aurora_gold_batch_duration_seconds",
            "Wall-clock duration of one Gold build attempt.",
            ["status"],
            registry=self.registry,
        )
        self.inflight = Gauge(
            "aurora_gold_inflight_builds",
            "Gold batches currently being materialized.",
            registry=self.registry,
        )
        self.queue_depth = Gauge(
            "aurora_gold_queue_depth",
            "Gold batches waiting for a materialization worker.",
            registry=self.registry,
        )
        self.input_records = Counter(
            "aurora_gold_input_records_total",
            "Silver light-curve records committed by successful Gold builds.",
            registry=self.registry,
        )
        self.output_rows = Counter(
            "aurora_gold_output_rows_total",
            "Canonical Gold rows committed and indexed successfully.",
            registry=self.registry,
        )
        for status in _STATUSES:
            self.batches.labels(status=status)
            self.duration.labels(status=status)
        self.queue_depth.set(0)

    def set_queue_depth(self, depth: int) -> None:
        self.queue_depth.set(max(0, depth))

    def build_started(self) -> None:
        self.inflight.inc()

    def build_finished(
        self,
        status: str,
        elapsed_seconds: float,
        *,
        input_records: int = 0,
        output_rows: int = 0,
    ) -> None:
        bounded_status = status if status in _STATUSES else "failed"
        self.inflight.dec()
        self.batches.labels(status=bounded_status).inc()
        self.duration.labels(status=bounded_status).observe(max(0.0, elapsed_seconds))
        if bounded_status == "success":
            self.input_records.inc(max(0, input_records))
            self.output_rows.inc(max(0, output_rows))


class MetricsServer:
    """Lifecycle wrapper around prometheus_client's threaded HTTP server."""

    def __init__(self, address: str, metrics: Metrics) -> None:
        host, port = _parse_address(address)
        self._server, self._thread = start_http_server(
            port,
            addr=host,
            registry=metrics.registry,
        )

    def close(self) -> None:
        self._server.shutdown()
        self._server.server_close()
        self._thread.join(timeout=2)


def _parse_address(address: str) -> tuple[str, int]:
    normalized = address.strip()
    if normalized.startswith(":"):
        return "0.0.0.0", int(normalized[1:])
    host, separator, raw_port = normalized.rpartition(":")
    if not separator or not raw_port:
        raise ValueError("metrics address must be HOST:PORT or :PORT")
    return host or "0.0.0.0", int(raw_port)
