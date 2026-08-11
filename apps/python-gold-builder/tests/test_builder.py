import hashlib
import io
import os
import sys

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from aurora_gold_builder.builder import GoldBuilder
from aurora_gold_builder.events import SilverEvent
from aurora_gold_builder.store import MemoryObjectStore


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
        "sha256": "",
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


def test_build_candidate_snapshot_from_silver():
    store = MemoryObjectStore()
    data = _silver_bytes()
    payload = _silver_event()
    payload["size_bytes"] = len(data)
    payload["sha256"] = hashlib.sha256(data).hexdigest()
    event = SilverEvent.from_dict(payload)
    store.put_bytes("aurora", event.object_key, data, "application/octet-stream")

    result = GoldBuilder(store).build_candidate([event], set_current=True)

    assert result.snapshot_id.startswith("gold-v1-")
    assert result.row_count == 1
    manifest = store.get_json("aurora", result.manifest_key)
    assert manifest["status"] == "COMMITTED"
    assert manifest["row_count"] == 1
    assert (
        store.get_json("aurora", "gold/current/CANDIDATE.json")["snapshot_id"]
        == result.snapshot_id
    )

    artifact_key = manifest["artifacts"][0]["object_key"]
    table = pq.read_table(io.BytesIO(store.get_bytes("aurora", artifact_key)))
    row = table.to_pylist()[0]
    assert row["tic_id"] == 123
    assert row["bls_available"] is True
    assert row["training_label"] == "UNRESOLVED"
