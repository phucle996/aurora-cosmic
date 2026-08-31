import hashlib
import io
import os
import sys

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from aurora.gold_builder.application.catalogs import (
    import_catalog_rows,
    load_active_catalogs,
    sync_catalogs_for_tics,
)
from aurora.gold_builder.application.control import (
    GoldControl,
    load_control,
    save_runtime_status,
)
from aurora.gold_builder.application.materializer import GoldBuildError, GoldBuilder
from aurora.gold_builder.application.readiness import MultimodalReadiness
from aurora.gold_builder.domain.events import SilverEvent
from aurora.gold_builder.infrastructure.object_store import MemoryObjectStore
from aurora_ml.pipeline.evidence import (
    compute_tpf_features,
    compute_tpf_features_from_cube,
)


def _silver_event(key="silver/test/lightcurve.parquet"):
    return {
        "event_id": "event-1",
        "event_type": "silver.object.ready",
        "source_event_id": "bronze-1",
        "source_product_id": "tess-lc-123-s0001",
        "sample_id": "tic:123:s:1",
        "bucket": "aurora",
        "object_key": key,
        "product_kind": "LIGHT_CURVE",
        "schema_version": "silver-lightcurve-v1",
        "processor_version": "lc-preprocess-v1",
        "sector": 1,
        "tic_id": 123,
        "camera": None,
        "ccd": None,
        "size_bytes": 0,
        "sha256": "0" * 64,
        "occurred_at": "2026-01-01T00:00:00Z",
    }


def _silver_bytes():
    time = np.linspace(0, 20, 1000)
    flux = np.ones_like(time)
    flux[(time % 5.0 > 0.0) & (time % 5.0 < 0.2)] = 0.99
    table = pa.table(
        {
            "time": pa.array(time),
            "flux": pa.array(flux.astype(np.float32)),
            "flux_err": pa.array(np.full(len(time), np.nan, dtype=np.float32)),
            "quality": pa.array(np.zeros(len(time), dtype=np.int32)),
        }
    )
    buffer = io.BytesIO()
    pq.write_table(table, buffer, compression="ZSTD")
    return buffer.getvalue()


def _tpf_bytes():
    time = np.linspace(0, 20, 1000)
    flux = []
    for value in time:
        pixel_values = np.ones(9, dtype=np.float32)
        if value % 5.0 > 0.0 and value % 5.0 < 0.2:
            pixel_values[4] = 0.98
        flux.append(pixel_values.tolist())
    table = pa.table(
        {
            "time": pa.array(time),
            "quality": pa.array(np.zeros(len(time), dtype=np.int32)),
            "flux": pa.array(flux),
            "rows": pa.array(np.full(len(time), 3, dtype=np.int32)),
            "cols": pa.array(np.full(len(time), 3, dtype=np.int32)),
        }
    )
    buffer = io.BytesIO()
    pq.write_table(table, buffer, compression="ZSTD")
    return buffer.getvalue()


def _ffi_bytes():
    table = pa.table(
        {
            "width": pa.array([2048], type=pa.int32()),
            "height": pa.array([2048], type=pa.int32()),
            "finite_pixel_count": pa.array([4194304], type=pa.int64()),
            "finite_pixel_fraction": pa.array([1.0], type=pa.float32()),
            "median": pa.array([100.0], type=pa.float32()),
            "mean": pa.array([100.5], type=pa.float32()),
            "stddev": pa.array([4.0], type=pa.float32()),
            "min": pa.array([80.0], type=pa.float32()),
            "max": pa.array([120.0], type=pa.float32()),
        }
    )
    buffer = io.BytesIO()
    pq.write_table(table, buffer, compression="ZSTD")
    return buffer.getvalue()


def _event_with_data(base, kind, schema, key, data, **updates):
    payload = dict(base)
    payload.update(
        {
            "event_id": f"event-{kind.lower()}",
            "source_product_id": f"tess-{kind.lower()}-123-s0001",
            "object_key": key,
            "product_kind": kind,
            "schema_version": schema,
            "size_bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
        }
    )
    payload.update(updates)
    return SilverEvent.from_dict(payload)


def test_multimodal_readiness_waits_then_emits_one_complete_gold_unit():
    store = MemoryObjectStore()
    lc_event = SilverEvent.from_dict(_silver_event())
    tpf_event = _event_with_data(
        _silver_event(),
        "TARGET_PIXEL",
        "silver-target-pixel-v1",
        "silver/test/tpf.parquet",
        b"tpf",
    )
    readiness = MultimodalReadiness(store, "aurora")
    pending = [("checkpoints/gold-builder/pending/event-1.json", lc_event)]

    batches, summary = readiness.collect_ready(pending, max_targets=250)
    assert batches == []
    assert summary.state == "WAITING_FOR_TPF"
    assert summary.tic_catalog_ready is False
    assert summary.toi_catalog_ready is False

    readiness.persist_context(tpf_event)
    batches, summary = readiness.collect_ready(pending, max_targets=250)
    assert summary.state == "READY"
    assert summary.ready_lightcurves == 1
    assert summary.tpf_contexts == 1
    assert len(batches) == 1
    assert {event.product_kind for _, event in batches[0]} == {
        "LIGHT_CURVE",
        "TARGET_PIXEL",
    }


def test_on_demand_catalog_sync_pins_and_reuses_exact_batch_snapshots(monkeypatch):
    store = MemoryObjectStore()
    calls: list[tuple[str, tuple[int, ...]]] = []

    def tic_rows(tic_ids):
        calls.append(("TIC", tuple(tic_ids)))
        return [
            {"tic_id": tic_id, "ra": 12.3, "dec": -45.6, "tmag": 10.1}
            for tic_id in tic_ids
        ]

    def toi_rows(tic_ids):
        calls.append(("TOI", tuple(tic_ids)))
        return [{"toi_id": "123.01", "tic_id": 123, "period": 5.0}]

    monkeypatch.setattr(
        "aurora.gold_builder.application.catalogs.fetch_tic_rows", tic_rows
    )
    monkeypatch.setattr(
        "aurora.gold_builder.application.catalogs.fetch_toi_rows", toi_rows
    )

    first = sync_catalogs_for_tics(store, "aurora", [456, 123, 456])
    second = sync_catalogs_for_tics(store, "aurora", [123, 456])

    assert first.catalogs.availability == "COMPLETE"
    assert first.target_count == 2
    assert first.tic_records == 2
    assert first.toi_records == 1
    assert first.cache_hit is False
    assert second.cache_hit is True
    assert second.catalogs.snapshot_ids == first.catalogs.snapshot_ids
    assert calls == [("TIC", (123, 456)), ("TOI", (123, 456))]
    assert store.get_json("aurora", "catalogs/current/tic.json") is None
    assert store.get_json("aurora", "catalogs/current/toi.json") is None


def test_readiness_selects_the_newest_complete_silver_revision_deterministically():
    store = MemoryObjectStore()
    lightcurve = SilverEvent.from_dict(_silver_event())
    tpf_old = _event_with_data(
        _silver_event(),
        "TARGET_PIXEL",
        "silver-target-pixel-v1",
        "silver/test/tpf-old.parquet",
        b"tpf-old",
        processing_fingerprint="old-config",
        occurred_at="2026-01-01T00:00:00Z",
    )
    tpf_new = _event_with_data(
        _silver_event(),
        "TARGET_PIXEL",
        "silver-target-pixel-v1",
        "silver/test/tpf-new.parquet",
        b"tpf-new",
        event_id="event-target_pixel-new",
        processing_fingerprint="new-config",
        occurred_at="2026-01-02T00:00:00Z",
    )
    import_catalog_rows(
        store,
        "aurora",
        "TIC",
        [{"tic_id": 123}],
        provider="test",
        source_uri="test://tic",
    )
    import_catalog_rows(
        store,
        "aurora",
        "TOI",
        [],
        provider="test",
        source_uri="test://toi",
    )
    readiness = MultimodalReadiness(store, "aurora")
    readiness.persist_context(tpf_new)
    readiness.persist_context(tpf_old)

    batches, summary = readiness.collect_ready(
        [("checkpoints/gold-builder/pending/event-1.json", lightcurve)],
        max_targets=1,
    )

    assert summary.state == "READY"
    selected_tpf = next(
        event for _, event in batches[0] if event.product_kind == "TARGET_PIXEL"
    )
    assert selected_tpf.revision_id == tpf_new.revision_id
    assert selected_tpf.object_key == tpf_new.object_key


def test_tpf_chunked_math_matches_the_existing_in_memory_contract():
    time = np.linspace(0, 4, 10)
    flux_cube = [np.arange(9, dtype=np.float64) + cadence for cadence in range(10)]
    metadata = {"source_product_id": "tpf-1", "product_kind": "TARGET_PIXEL"}

    expected = compute_tpf_features(
        time,
        flux_cube,
        rows=3,
        cols=3,
        metadata=metadata,
    )
    actual = compute_tpf_features_from_cube(
        time,
        np.asarray(flux_cube),
        rows=3,
        cols=3,
        metadata=metadata,
    )

    assert actual.to_dict() == expected.to_dict()


def legacy_multimodal_readiness_requires_every_ffi_in_durable_ingest_contract():
    store = MemoryObjectStore()
    lc_event = SilverEvent.from_dict(_silver_event())
    tpf_event = _event_with_data(
        _silver_event(),
        "TARGET_PIXEL",
        "silver-target-pixel-v1",
        "silver/test/tpf-contract.parquet",
        b"tpf",
        camera=1,
        ccd=2,
    )
    ffi_one = _event_with_data(
        _silver_event(),
        "FFI",
        "silver-ffi-v1",
        "silver/test/ffi-one.parquet",
        b"ffi-1",
        sample_id=None,
        camera=1,
        ccd=2,
    )
    ffi_two = _event_with_data(
        _silver_event(),
        "FFI",
        "silver-ffi-v1",
        "silver/test/ffi-two.parquet",
        b"ffi-2",
        sample_id=None,
        source_product_id="tess-ffi-456-s0001",
        event_id="event-ffi-two",
        camera=1,
        ccd=2,
    )
    store.put_json(
        "aurora",
        "checkpoints/ingestion/current.json",
        {
            "active_run_id": "ingest-contract",
            "manifest_hash": "contract-sha",
        },
    )
    store.put_json(
        "aurora",
        "checkpoints/ingestion/runs/ingest-contract.json",
        {
            "products": {
                "lc": {
                    "source_product_id": lc_event.source_product_id,
                    "product_kind": "LIGHT_CURVE",
                    "sample_id": lc_event.sample_id,
                    "sector": 1,
                    "camera": 1,
                    "ccd": 2,
                },
                "tpf": {
                    "source_product_id": tpf_event.source_product_id,
                    "product_kind": "TARGET_PIXEL",
                    "sample_id": tpf_event.sample_id,
                    "sector": 1,
                    "camera": 1,
                    "ccd": 2,
                },
                "ffi-one": {
                    "source_product_id": ffi_one.source_product_id,
                    "product_kind": "FFI",
                    "sector": 1,
                    "camera": 1,
                    "ccd": 2,
                },
                "ffi-two": {
                    "source_product_id": ffi_two.source_product_id,
                    "product_kind": "FFI",
                    "sector": 1,
                    "camera": 1,
                    "ccd": 2,
                },
            },
        },
    )
    import_catalog_rows(
        store,
        "aurora",
        "TIC",
        [{"tic_id": 123}],
        provider="test",
        source_uri="test://tic",
    )
    import_catalog_rows(
        store, "aurora", "TOI", [], provider="test", source_uri="test://toi"
    )
    readiness = MultimodalReadiness(store, "aurora")
    readiness.persist_context(tpf_event)
    readiness.persist_context(ffi_one)
    pending = [("checkpoints/gold-builder/pending/event-1.json", lc_event)]

    batches, summary = readiness.collect_ready(pending, max_targets=250)
    assert batches == []
    assert summary.state == "WAITING_FOR_MODALITY"
    assert summary.contracted_lightcurves == 1
    assert summary.missing_ffi == 1

    readiness.persist_context(ffi_two)
    batches, summary = readiness.collect_ready(pending, max_targets=250)
    assert summary.state == "READY"
    assert len(batches) == 1
    assert {event.source_product_id for _, event in batches[0]} == {
        lc_event.source_product_id,
        tpf_event.source_product_id,
        ffi_one.source_product_id,
        ffi_two.source_product_id,
    }


def legacy_multimodal_readiness_refreshes_detector_contract_within_same_run():
    store = MemoryObjectStore()
    lc_event = SilverEvent.from_dict(_silver_event())
    tpf_event = _event_with_data(
        _silver_event(),
        "TARGET_PIXEL",
        "silver-target-pixel-v1",
        "silver/test/tpf-wave.parquet",
        b"tpf",
        camera=2,
        ccd=3,
    )
    ffi_event = _event_with_data(
        _silver_event(),
        "FFI",
        "silver-ffi-v1",
        "silver/test/ffi-wave.parquet",
        b"ffi",
        sample_id=None,
        camera=2,
        ccd=3,
    )
    pointer_key = "checkpoints/ingestion/current.json"
    run_key = "checkpoints/ingestion/runs/wave-run.json"
    store.put_json(
        "aurora",
        pointer_key,
        {
            "active_run_id": "wave-run",
            "manifest_hash": "same-manifest",
            "last_updated_at": "2026-08-31T00:00:00Z",
        },
    )
    base_products = {
        "lc": {
            "source_product_id": lc_event.source_product_id,
            "product_kind": "LIGHT_CURVE",
            "sample_id": lc_event.sample_id,
            "sector": 1,
            "camera": 2,
            "ccd": 3,
        },
        "tpf": {
            "source_product_id": tpf_event.source_product_id,
            "product_kind": "TARGET_PIXEL",
            "sample_id": tpf_event.sample_id,
            "sector": 1,
            "camera": 2,
            "ccd": 3,
        },
    }
    store.put_json("aurora", run_key, {"products": base_products})
    import_catalog_rows(
        store,
        "aurora",
        "TIC",
        [{"tic_id": 123}],
        provider="test",
        source_uri="test://tic",
    )
    import_catalog_rows(
        store, "aurora", "TOI", [], provider="test", source_uri="test://toi"
    )
    readiness = MultimodalReadiness(store, "aurora")
    readiness.persist_context(tpf_event)
    readiness.persist_context(ffi_event)
    pending = [("checkpoints/gold-builder/pending/event-1.json", lc_event)]

    batches, summary = readiness.collect_ready(pending, max_targets=250)
    assert batches == []
    assert summary.missing_ffi == 1

    store.put_json(
        "aurora",
        run_key,
        {
            "products": {
                **base_products,
                "ffi": {
                    "source_product_id": ffi_event.source_product_id,
                    "product_kind": "FFI",
                    "sector": 1,
                    "camera": 2,
                    "ccd": 3,
                },
            }
        },
    )
    store.put_json(
        "aurora",
        pointer_key,
        {
            "active_run_id": "wave-run",
            "manifest_hash": "same-manifest",
            "last_updated_at": "2026-08-31T00:00:01Z",
        },
    )

    batches, summary = readiness.collect_ready(pending, max_targets=250)
    assert summary.state == "READY"
    assert len(batches) == 1


def test_gold_operator_control_defaults_to_paused_and_persists_runtime_status():
    store = MemoryObjectStore()
    control = load_control(store, "aurora")
    assert control.mode == "PAUSED"

    stream = GoldControl(
        mode="STREAM",
        max_batch_records=250,
        idle_flush_seconds=180,
        command_id="gold-1",
    )
    store.put_json("aurora", "control/gold-builder.json", stream.to_dict())
    assert load_control(store, "aurora") == stream
    assert (
        store.get_json("aurora", "control/gold-builder.json")["max_batch_records"]
        == 250
    )

    save_runtime_status(
        store,
        "aurora",
        state="ARMED",
        control=stream,
        pending_by_kind={"LIGHT_CURVE": 0, "TARGET_PIXEL": 0},
        active_builds=0,
        readiness={"catalog_ready": True, "ready_lightcurves": 1},
    )
    status = store.get_json("aurora", "control/gold-builder/status.json")
    assert status["state"] == "ARMED"
    assert status["pending_total"] == 0
    assert status["readiness"]["catalog_ready"] is True


def test_recovers_unextracted_silver_from_committed_lineage_into_pending_queue():
    store = MemoryObjectStore()
    lineage = {
        "schema_version": 1,
        "lineage_id": "lineage-lc-123",
        "status": "LINEAGE_COMMITTED",
        "source": {"source_product_id": "tess-lc-123-s0001"},
        "bronze": {
            "product_kind": "LIGHT_CURVE",
            "sector": 1,
            "tic_id": 123,
            "camera": None,
            "ccd": None,
        },
        "processing": {
            "processor_version": "lc-preprocess-v1",
            "product_kind": "LIGHT_CURVE",
        },
        "silver": {
            "bucket": "aurora",
            "object_key": "silver/tess/lightcurve/lc-123.parquet",
            "size_bytes": 42,
            "sha256": "a" * 64,
            "schema_version": "silver-lightcurve-v1",
            "processor_version": "lc-preprocess-v1",
        },
        "preprocessing_checkpoint_id": "checkpoint-123",
        "committed_at": "2026-08-30T00:00:00Z",
    }
    store.put_json("aurora", "lineage/v1/tess/lightcurve/lineage-lc-123.json", lineage)

    builder = GoldBuilder(store)
    recovered = builder.recover_pending_from_lineage("aurora")

    assert len(recovered) == 1
    assert recovered[0][1].object_key == lineage["silver"]["object_key"]
    assert len(builder.pending_events("aurora")) == 1

    store.put_json(
        "aurora",
        "gold/snapshots/gold-v1/manifest.json",
        {
            "status": "COMMITTED",
            "completeness_contract": {"policy": "research-ready-target-pair-v4"},
            "inputs": [{"silver_object_key": lineage["silver"]["object_key"]}],
        },
    )
    builder.clear_pending(recovered)
    assert builder.recover_pending_from_lineage("aurora") == []


def test_lineage_recovery_observes_new_silver_incrementally_while_paused():
    store = MemoryObjectStore()
    builder = GoldBuilder(store)

    assert builder.recover_pending_from_lineage("aurora") == []

    lineage = {
        "lineage_id": "lineage-incremental-lc",
        "status": "LINEAGE_COMMITTED",
        "source": {"source_product_id": "tess-lc-incremental"},
        "bronze": {"product_kind": "LIGHT_CURVE", "sector": 1, "tic_id": 456},
        "processing": {
            "processor_version": "lc-preprocess-v1",
            "product_kind": "LIGHT_CURVE",
        },
        "silver": {
            "bucket": "aurora",
            "object_key": "silver/tess/lightcurve/incremental.parquet",
            "size_bytes": 42,
            "sha256": "c" * 64,
            "schema_version": "silver-lightcurve-v1",
        },
    }
    store.put_json(
        "aurora", "lineage/v1/tess/lightcurve/incremental.json", lineage
    )

    recovered = builder.recover_pending_from_lineage("aurora")
    assert len(recovered) == 1
    assert recovered[0][1].tic_id == 456
    assert builder.recover_pending_from_lineage("aurora") == []


def test_pending_checkpoint_is_removed_when_gold_committed_before_worker_ack():
    store = MemoryObjectStore()
    event = SilverEvent.from_dict(_silver_event())
    builder = GoldBuilder(store)
    builder.save_pending(event)
    store.put_json(
        "aurora",
        "gold/snapshots/gold-v1-committed/manifest.json",
        {
            "status": "COMMITTED",
            "completeness_contract": {"policy": "research-ready-target-pair-v4"},
            "inputs": [{"silver_object_key": event.object_key}],
        },
    )

    assert builder.pending_unextracted_events("aurora") == []
    assert builder.pending_events("aurora") == []


def test_legacy_partial_gold_does_not_suppress_research_ready_recovery():
    store = MemoryObjectStore()
    lineage = {
        "lineage_id": "lineage-legacy-lc",
        "status": "LINEAGE_COMMITTED",
        "source": {"source_product_id": "tess-lc-legacy"},
        "bronze": {"product_kind": "LIGHT_CURVE", "sector": 1, "tic_id": 123},
        "processing": {
            "processor_version": "lc-preprocess-v1",
            "product_kind": "LIGHT_CURVE",
        },
        "silver": {
            "bucket": "aurora",
            "object_key": "silver/tess/lightcurve/legacy.parquet",
            "size_bytes": 42,
            "sha256": "b" * 64,
            "schema_version": "silver-lightcurve-v1",
        },
    }
    store.put_json("aurora", "lineage/v1/tess/lightcurve/legacy.json", lineage)
    store.put_json(
        "aurora",
        "gold/snapshots/gold-v1-legacy/manifest.json",
        {
            "status": "COMMITTED",
            "inputs": [{"silver_object_key": lineage["silver"]["object_key"]}],
        },
    )

    recovered = GoldBuilder(store).recover_pending_from_lineage("aurora")
    assert len(recovered) == 1
    assert recovered[0][1].source_product_id == "tess-lc-legacy"


def test_gold_builder_rejects_partial_gold_inputs():
    store = MemoryObjectStore()
    data = _silver_bytes()
    payload = _silver_event()
    payload["size_bytes"] = len(data)
    payload["sha256"] = hashlib.sha256(data).hexdigest()
    event = SilverEvent.from_dict(payload)
    store.put_bytes("aurora", event.object_key, data, "application/octet-stream")

    try:
        GoldBuilder(store).build_candidate([event], set_current=True)
    except GoldBuildError as exc:
        assert "catalog snapshots" in str(exc)
    else:
        raise AssertionError("partial LC-only Gold build must be rejected")


def test_gold_builder_pins_catalog_snapshots_and_auto_labels_confirmed_toi():
    store = MemoryObjectStore()
    data = _silver_bytes()
    payload = _silver_event()
    payload["sample_id"] = "sample:tic=123:sector=0001"
    payload["size_bytes"] = len(data)
    payload["sha256"] = hashlib.sha256(data).hexdigest()
    event = SilverEvent.from_dict(payload)
    store.put_bytes("aurora", event.object_key, data, "application/octet-stream")

    feature = GoldBuilder(store)._lightcurve_features(event)
    assert feature.bls_available is True
    assert feature.bls_period is not None
    import_catalog_rows(
        store,
        "aurora",
        "TIC",
        [{"tic_id": 123, "tmag": 10.4, "teff": 5500, "rad": 1.1}],
        provider="test",
        source_uri="test://tic",
    )
    toi_manifest = import_catalog_rows(
        store,
        "aurora",
        "TOI",
        [
            {
                "toi_id": "123.01",
                "tic_id": 123,
                "period": feature.bls_period,
                "epoch": feature.bls_transit_time,
                "tfopwg_disp": "Confirmed Planet",
            }
        ],
        provider="test",
        source_uri="test://toi",
    )
    import_catalog_rows(
        store,
        "aurora",
        "TCE",
        [
            {
                "tce_id": "tce-123",
                "tic_id": 123,
                "sector": 1,
                "period": feature.bls_period,
            }
        ],
        provider="test",
        source_uri="test://tce",
    )

    tpf_data = _tpf_bytes()
    tpf_event = _event_with_data(
        payload,
        "TARGET_PIXEL",
        "silver-target-pixel-v1",
        "silver/test/tpf-catalog.parquet",
        tpf_data,
        processing_fingerprint="tpf-config-v1",
    )
    store.put_bytes(
        "aurora", tpf_event.object_key, tpf_data, "application/octet-stream"
    )
    result = GoldBuilder(store).build_candidate(
        [event, tpf_event], catalogs=load_active_catalogs(store, "aurora")
    )
    manifest = store.get_json("aurora", result.manifest_key)
    artifact = next(
        item for item in manifest["artifacts"] if item["dataset"] == "candidate"
    )
    row = pq.read_table(
        io.BytesIO(store.get_bytes("aurora", artifact["object_key"]))
    ).to_pylist()[0]

    assert row["tic_available"] is True
    assert row["matched_toi_id"] == "123.01"
    assert row["toi_match_status"] in {"EPHEMERIS_MATCH", "PERIOD_ONLY"}
    assert manifest["catalog_snapshots"]["TOI"] == toi_manifest.snapshot_id
    assert "tce_match_status" not in row
    assert "training_label" not in row
    assert "toi_catalog_snapshot_id" not in row
    tpf_input = next(
        item for item in manifest["inputs"] if item["product_kind"] == "TARGET_PIXEL"
    )
    assert tpf_input["processing_fingerprint"] == "tpf-config-v1"
    assert tpf_input["silver_revision_id"] == tpf_event.revision_id
    assert load_active_catalogs(store, "aurora").availability == "COMPLETE"


def test_build_snapshot_materializes_candidate_gold_from_lc_and_tpf():
    store = MemoryObjectStore()
    lc_data = _silver_bytes()
    tpf_data = _tpf_bytes()
    lc_payload = _silver_event()
    lc_payload["size_bytes"] = len(lc_data)
    lc_payload["sha256"] = hashlib.sha256(lc_data).hexdigest()
    lc_event = SilverEvent.from_dict(lc_payload)
    tpf_event = _event_with_data(
        lc_payload,
        "TARGET_PIXEL",
        "silver-target-pixel-v1",
        "silver/test/tpf.parquet",
        tpf_data,
    )
    for event, data in (
        (lc_event, lc_data),
        (tpf_event, tpf_data),
    ):
        store.put_bytes("aurora", event.object_key, data, "application/octet-stream")

    import_catalog_rows(
        store,
        "aurora",
        "TIC",
        [{"tic_id": 123, "tmag": 10.4}],
        provider="test",
        source_uri="test://tic",
    )
    import_catalog_rows(
        store,
        "aurora",
        "TOI",
        [],
        provider="test",
        source_uri="test://toi",
    )

    result = GoldBuilder(store).build_candidate(
        [lc_event, tpf_event],
        set_current=True,
        catalogs=load_active_catalogs(store, "aurora"),
    )

    assert result.dataset_row_counts == {"candidate": 1}
    manifest = store.get_json("aurora", result.manifest_key)
    assert manifest["datasets"] == ["candidate"]
    assert manifest["dataset_row_counts"] == result.dataset_row_counts
    assert store.get_json("aurora", "gold/current/ANOMALY.json") is None

    artifacts = {record["dataset"]: record for record in manifest["artifacts"]}
    candidate_table = pq.read_table(
        io.BytesIO(store.get_bytes("aurora", artifacts["candidate"]["object_key"]))
    )
    candidate_row = candidate_table.to_pylist()[0]
    assert candidate_row["transit_evidence_available"] is True
    assert "tpf_evidence_available" not in candidate_row
    assert "tce_match_status" not in candidate_row
