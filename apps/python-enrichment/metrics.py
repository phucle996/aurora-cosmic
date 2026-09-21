"""Low-cardinality Prometheus metrics for durable Gold materialization and DAG telemetry."""

from __future__ import annotations

from prometheus_client import CollectorRegistry, Counter, Gauge, Histogram
from prometheus_client.exposition import start_http_server

_STATUSES = ("success", "failed", "deferred")
_STEPS = (
    "pairing",
    "catalog",
    "lc_features",
    "bls",
    "tpf_vetting",
    "candidate",
    "parquet",
    "index",
    "commit",
)


class Metrics:
    """Own the Gold Builder metric registry and bounded signal contract across all 7 steps."""

    def __init__(self) -> None:
        self.registry = CollectorRegistry(auto_describe=True)

        # -----------------------------------------------------------------
        # Core Pipeline & Batch Telemetry
        # -----------------------------------------------------------------
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

        # -----------------------------------------------------------------
        # Step 1: Multimodal Pairing Telemetry
        # -----------------------------------------------------------------
        self.pairing_waiting = Gauge(
            "aurora_enrichment_pairing_waiting",
            "Unpaired light-curves waiting for matching TPF context.",
            registry=self.registry,
        )
        self.paired_pairs = Counter(
            "aurora_enrichment_paired_pairs_total",
            "Successfully paired multimodal Light-Curve and TPF targets.",
            registry=self.registry,
        )
        self.pairing_dropped = Counter(
            "aurora_enrichment_pairing_dropped_total",
            "Unpaired or orphaned Silver products dropped from Gold intake.",
            registry=self.registry,
        )

        # -----------------------------------------------------------------
        # Step 2: Catalog Synchronization Telemetry
        # -----------------------------------------------------------------
        self.catalog_records = Counter(
            "aurora_enrichment_catalog_records_total",
            "Catalog records resolved from immutable snapshot indices.",
            ["catalog"],
            registry=self.registry,
        )
        self.catalog_cache_hits = Counter(
            "aurora_enrichment_catalog_cache_hits_total",
            "Catalog queries satisfied by memory or warm cache.",
            registry=self.registry,
        )
        self.catalog_sync_duration = Histogram(
            "aurora_enrichment_catalog_sync_duration_seconds",
            "Wall-clock duration of TIC and TOI catalog sync operations.",
            registry=self.registry,
        )

        # -----------------------------------------------------------------
        # Step 3 & 4: Scientific Features & Candidate Assembly Telemetry
        # -----------------------------------------------------------------
        self.step_duration = Histogram(
            "aurora_enrichment_step_duration_seconds",
            "Latency distribution for individual Gold pipeline phases.",
            ["step"],
            registry=self.registry,
        )
        self.step_records = Counter(
            "aurora_enrichment_step_records_total",
            "Records processed successfully by specific pipeline phases.",
            ["step"],
            registry=self.registry,
        )
        self.bls_candidates = Counter(
            "aurora_enrichment_bls_candidates_detected_total",
            "Periodic transit candidate ephemerides detected via BLS search.",
            registry=self.registry,
        )
        self.tpf_transit_evidence = Counter(
            "aurora_enrichment_tpf_transit_evidence_total",
            "Targets with measurable in-transit spatial flux deficit evidence.",
            registry=self.registry,
        )
        self.candidates_assembled = Counter(
            "aurora_enrichment_candidate_assembled_total",
            "Unified canonical candidate records assembled for Parquet materialization.",
            registry=self.registry,
        )
        self.toi_matches = Counter(
            "aurora_enrichment_toi_matches_total",
            "Candidates evaluated against NASA Exoplanet Archive TOI ephemerides.",
            ["status"],
            registry=self.registry,
        )

        # -----------------------------------------------------------------
        # Step 5: Parquet Materialization Telemetry
        # -----------------------------------------------------------------
        self.parquet_duration = Histogram(
            "aurora_enrichment_parquet_write_duration_seconds",
            "Wall-clock time spent writing and uploading sector Parquet partitions.",
            registry=self.registry,
        )
        self.parquet_bytes = Counter(
            "aurora_enrichment_parquet_bytes_total",
            "Total bytes written for Gold Parquet partitions in MinIO.",
            registry=self.registry,
        )

        # -----------------------------------------------------------------
        # Step 6: ClickHouse Analytical Indexing Telemetry
        # -----------------------------------------------------------------
        self.clickhouse_duration = Histogram(
            "aurora_enrichment_clickhouse_index_duration_seconds",
            "Time spent indexing candidate rows into ClickHouse real-time tables.",
            registry=self.registry,
        )
        self.clickhouse_indexed_rows = Counter(
            "aurora_enrichment_clickhouse_indexed_rows_total",
            "Candidate rows indexed into ClickHouse ReplacingMergeTree engine.",
            registry=self.registry,
        )

        # -----------------------------------------------------------------
        # Step 7: Atomic Snapshot Commit Telemetry
        # -----------------------------------------------------------------
        self.snapshot_commits = Counter(
            "aurora_enrichment_snapshot_commits_total",
            "Atomic snapshot release manifests committed to MinIO and NATS.",
            ["status"],
            registry=self.registry,
        )

        # Initialize common low-cardinality labels
        for status in _STATUSES:
            self.batches.labels(status=status)
            self.duration.labels(status=status)
            self.snapshot_commits.labels(status=status)

        for step in _STEPS:
            self.step_duration.labels(step=step)
            self.step_records.labels(step=step)

        for catalog in ("TIC", "TOI"):
            self.catalog_records.labels(catalog=catalog)

        for status in ("MATCHED", "NO_MATCH", "UNAVAILABLE"):
            self.toi_matches.labels(status=status)

        self.queue_depth.set(0)
        self.pairing_waiting.set(0)

    def set_queue_depth(self, depth: int) -> None:
        self.queue_depth.set(max(0, depth))

    def set_pairing_waiting(self, count: int) -> None:
        self.pairing_waiting.set(max(0, count))

    def record_pairing(self, pairs: int, dropped: int = 0) -> None:
        if pairs > 0:
            self.paired_pairs.inc(pairs)
            self.step_records.labels(step="pairing").inc(pairs)
        if dropped > 0:
            self.pairing_dropped.inc(dropped)

    def record_catalog_sync(
        self,
        tic_count: int,
        toi_count: int,
        elapsed_seconds: float,
        cache_hit: bool = False,
    ) -> None:
        self.catalog_records.labels(catalog="TIC").inc(max(0, tic_count))
        self.catalog_records.labels(catalog="TOI").inc(max(0, toi_count))
        self.catalog_sync_duration.observe(max(0.0, elapsed_seconds))
        self.step_duration.labels(step="catalog").observe(max(0.0, elapsed_seconds))
        self.step_records.labels(step="catalog").inc(max(0, tic_count + toi_count))
        if cache_hit:
            self.catalog_cache_hits.inc()

    def record_step(self, step: str, elapsed_seconds: float, records: int = 0) -> None:
        if step in _STEPS:
            self.step_duration.labels(step=step).observe(max(0.0, elapsed_seconds))
            if records > 0:
                self.step_records.labels(step=step).inc(records)

    def record_parquet_write(self, elapsed_seconds: float, byte_count: int) -> None:
        self.parquet_duration.observe(max(0.0, elapsed_seconds))
        self.step_duration.labels(step="parquet").observe(max(0.0, elapsed_seconds))
        if byte_count > 0:
            self.parquet_bytes.inc(byte_count)

    def record_clickhouse_index(self, elapsed_seconds: float, row_count: int) -> None:
        self.clickhouse_duration.observe(max(0.0, elapsed_seconds))
        self.step_duration.labels(step="index").observe(max(0.0, elapsed_seconds))
        if row_count > 0:
            self.clickhouse_indexed_rows.inc(row_count)
            self.step_records.labels(step="index").inc(row_count)

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
        self.snapshot_commits.labels(status=bounded_status).inc()
        self.step_duration.labels(step="commit").observe(max(0.0, elapsed_seconds))
        if bounded_status == "success":
            self.input_records.inc(max(0, input_records))
            self.output_rows.inc(max(0, output_rows))
            self.step_records.labels(step="commit").inc(max(0, output_rows))


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
