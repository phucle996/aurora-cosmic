from pathlib import Path

from aurora_ml.domain.training import TASK_CANDIDATE
from aurora_ml.infrastructure.training_store import LoadedGoldSnapshot, TrainingStore
from aurora_ml.pipeline.gold import GoldSnapshotManifest, SilverInputRef


def _loaded(
    snapshot_id: str, created_at: str, source_id: str, label: str
) -> LoadedGoldSnapshot:
    source = SilverInputRef(
        lineage_id=f"lineage-{source_id}",
        source_product_id=source_id,
        product_kind="LIGHTCURVE",
        silver_bucket="aurora",
        silver_object_key=f"silver/{source_id}.parquet",
        silver_sha256="a" * 64,
        silver_schema_version="silver-lightcurve-v1",
        processor_version="lc-v1",
    )
    manifest = GoldSnapshotManifest(
        snapshot_id=snapshot_id,
        snapshot_fingerprint="b" * 64,
        snapshot_type="CANDIDATE",
        gold_schema_version="gold-candidate-v4",
        feature_versions={"candidate": "v4"},
        input_count=1,
        inputs=[source],
        created_at=created_at,
    )
    return LoadedGoldSnapshot(
        snapshot_id=snapshot_id,
        manifest=manifest,
        raw_manifest={"snapshot_id": snapshot_id, "created_at": created_at},
        manifest_sha256="c" * 64,
        rows=[{"source_product_id": source_id, "training_label": label}],
    )


def test_multi_snapshot_curated_view_is_deterministic_and_deduplicated(
    monkeypatch,
) -> None:
    older = _loaded(
        "gold-v1-000000000001", "2026-08-01T00:00:00Z", "source-1", "UNRESOLVED"
    )
    newer = _loaded(
        "gold-v1-000000000002", "2026-08-02T00:00:00Z", "source-1", "POSITIVE"
    )
    snapshots = {item.snapshot_id: item for item in (older, newer)}
    store = TrainingStore(objects=None, workspace=Path("."))  # type: ignore[arg-type]
    monkeypatch.setattr(
        store,
        "load_gold_snapshot",
        lambda _task, snapshot_id: snapshots[snapshot_id],
    )

    forward = store.load_gold_snapshots(
        TASK_CANDIDATE, (older.snapshot_id, newer.snapshot_id)
    )
    reverse = store.load_gold_snapshots(
        TASK_CANDIDATE, (newer.snapshot_id, older.snapshot_id)
    )

    assert forward.snapshot_id == reverse.snapshot_id
    assert forward.snapshot_id.startswith("gold-v1-curated-")
    assert forward.rows == [
        {"source_product_id": "source-1", "training_label": "POSITIVE"}
    ]
    assert forward.manifest.input_count == 1
    assert len(forward.raw_manifest["source_gold_snapshots"]) == 2
