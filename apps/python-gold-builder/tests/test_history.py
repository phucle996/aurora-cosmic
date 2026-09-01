from datetime import datetime, timezone
from threading import RLock

from aurora.gold_builder.application.control import GoldControl
from aurora.gold_builder.application.materializer import GoldBuildResult
from aurora.gold_builder.infrastructure.history import FactoryHistoryWriter


class RecordingClickHouse:
    def __init__(self) -> None:
        self.inserts: list[tuple[str, list[list[object]], list[str]]] = []

    def insert(self, table, rows, column_names) -> None:
        self.inserts.append((table, rows, column_names))


def test_completed_batch_records_each_scientific_component() -> None:
    writer = FactoryHistoryWriter.__new__(FactoryHistoryWriter)
    writer._lock = RLock()
    writer.clickhouse = RecordingClickHouse()
    result = GoldBuildResult(
        snapshot_id="gold-test",
        snapshot_fingerprint="fingerprint",
        manifest_key="gold/snapshots/gold-test/manifest.json",
        manifest_sha256="manifest-sha",
        row_count=3,
        artifact_count=1,
        set_current=True,
        lightcurve_inputs=3,
        target_pixel_inputs=3,
        lightcurve_feature_rows=3,
        bls_evidence_rows=2,
        target_pixel_evidence_rows=3,
        catalog_enriched_rows=3,
    )
    now = datetime.now(timezone.utc)

    writer.record_batch(
        GoldControl(mode="BATCH", command_id="run-test"),
        result,
        input_records=3,
        indexed_rows=3,
        started_at=now,
        completed_at=now,
    )

    component_rows = [
        row
        for table, rows, _ in writer.clickhouse.inserts
        if table == "pipeline_component_events_v1"
        for row in rows
    ]
    by_component = {row[2]: row for row in component_rows}
    expected = {
        "gold-pairing",
        "gold-catalog",
        "gold-lc-features",
        "gold-bls",
        "gold-tpf-evidence",
        "gold-candidate",
        "gold-parquet",
        "gold-index",
        "gold-commit",
    }
    assert expected <= by_component.keys()
    assert by_component["gold-bls"][5:7] == [3, 2]
    assert by_component["gold-index"][5:8] == [3, 3, 3]
    assert all(by_component[component][3] == "COMPLETED" for component in expected)
