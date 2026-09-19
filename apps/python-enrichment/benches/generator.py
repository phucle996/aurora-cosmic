"""Fast in-memory synthetic scientific data generator for Aurora Enrichment benchmarks.

Generates realistic, validated:
1. Silver Light Curve Parquet files (with optional transit injection and BLS-detectable signals).
2. Silver Target Pixel File (TPF) Parquet files (with custom spatial pixel dimensions and cadence counts).
3. TIC, TOI, and TCE astronomical catalog rows.
4. Silver lineage commit records.
"""

from __future__ import annotations

import hashlib
import io
from typing import Any

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq

from events import SilverEvent
from pipeline.catalogs import import_catalog_rows
from storage.object_store import ObjectStore


def compute_sha256(data: bytes) -> str:
    """Compute SHA-256 hex digest."""
    return hashlib.sha256(data).hexdigest()


def generate_lightcurve_parquet(
    tic_id: int,
    sector: int = 1,
    cadences: int = 1000,
    inject_transit: bool = True,
    period_days: float = 3.5,
    transit_depth: float = 0.015,
) -> tuple[bytes, str, SilverEvent]:
    """Generate in-memory Silver Light Curve Parquet file and SilverEvent.

    Produces realistic normalized flux with Gaussian photometric noise and
    optional periodic planetary transit dips.
    """
    time_series = np.linspace(0.0, 27.4, cadences, dtype=np.float64)
    np.random.seed(tic_id % (2**31 - 1))
    noise = np.random.normal(0.0, 0.001, size=cadences).astype(np.float32)
    flux = np.ones(cadences, dtype=np.float32) + noise

    if inject_transit and period_days > 0:
        transit_phase = (time_series % period_days) / period_days
        transit_mask = (transit_phase < 0.04) | (transit_phase > 0.96)
        flux[transit_mask] -= np.float32(transit_depth)

    flux_err = np.full(cadences, 0.001, dtype=np.float32)
    quality = np.zeros(cadences, dtype=np.int32)

    table = pa.table(
        {
            "time": pa.array(time_series, type=pa.float64()),
            "flux": pa.array(flux, type=pa.float32()),
            "flux_err": pa.array(flux_err, type=pa.float32()),
            "quality": pa.array(quality, type=pa.int32()),
        }
    )

    buffer = io.BytesIO()
    pq.write_table(table, buffer, compression="ZSTD")
    parquet_bytes = buffer.getvalue()
    sha256 = compute_sha256(parquet_bytes)

    object_key = f"silver/tess/lightcurve/sector_{sector:04d}/tic_{tic_id:012d}.parquet"
    event = SilverEvent.from_dict(
        {
            "event_id": f"evt-lc-{tic_id}-s{sector:04d}",
            "event_type": "silver.object.ready",
            "source_event_id": f"bronze-lc-{tic_id}-s{sector:04d}",
            "source_product_id": f"tess-lc-{tic_id}-s{sector:04d}",
            "sample_id": f"sample:tic={tic_id}:sector={sector:04d}",
            "bucket": "aurora",
            "object_key": object_key,
            "product_kind": "LIGHT_CURVE",
            "schema_version": "silver-lightcurve-v1",
            "processor_version": "lc-preprocess-v1",
            "sector": sector,
            "tic_id": tic_id,
            "camera": 1,
            "ccd": 1,
            "size_bytes": len(parquet_bytes),
            "sha256": sha256,
            "occurred_at": "2026-01-01T00:00:00Z",
        }
    )

    return parquet_bytes, sha256, event


def generate_tpf_parquet(
    tic_id: int,
    sector: int = 1,
    cadences: int = 1000,
    rows: int = 11,
    cols: int = 11,
) -> tuple[bytes, str, SilverEvent]:
    """Generate in-memory Silver Target Pixel File (TPF) Parquet and SilverEvent.

    For small dimensions (11x11), generated data fits easily in RAM.
    For large dimensions (e.g. 70x70 with 2000 cadences), cube size is ~78 MiB,
    which triggers the TPF_IN_MEMORY_CUBE_LIMIT_BYTES (64 MiB) disk memmap threshold.
    """
    time_series = np.linspace(0.0, 27.4, cadences, dtype=np.float64)
    pixels_per_cadence = rows * cols

    center_r = rows // 2
    center_c = cols // 2
    center_idx = center_r * cols + center_c

    # Build pixel values
    pixel_batch = np.ones(pixels_per_cadence, dtype=np.float32)
    flux_list: list[list[float]] = []

    for t in time_series:
        cadence_pixels = pixel_batch.copy()
        # transit dip on target pixel in center
        if (t % 3.5 > 0.0) and (t % 3.5 < 0.15):
            cadence_pixels[center_idx] = 0.98
        flux_list.append(cadence_pixels.tolist())

    table = pa.table(
        {
            "time": pa.array(time_series, type=pa.float64()),
            "quality": pa.array(np.zeros(cadences, dtype=np.int32), type=pa.int32()),
            "flux": pa.array(flux_list),
            "rows": pa.array(np.full(cadences, rows, dtype=np.int32), type=pa.int32()),
            "cols": pa.array(np.full(cadences, cols, dtype=np.int32), type=pa.int32()),
        }
    )

    buffer = io.BytesIO()
    pq.write_table(table, buffer, compression="ZSTD")
    parquet_bytes = buffer.getvalue()
    sha256 = compute_sha256(parquet_bytes)

    object_key = (
        f"silver/tess/target_pixel/sector_{sector:04d}/tic_{tic_id:012d}.parquet"
    )
    event = SilverEvent.from_dict(
        {
            "event_id": f"evt-tpf-{tic_id}-s{sector:04d}",
            "event_type": "silver.object.ready",
            "source_event_id": f"bronze-tpf-{tic_id}-s{sector:04d}",
            "source_product_id": f"tess-tpf-{tic_id}-s{sector:04d}",
            "sample_id": f"sample:tic={tic_id}:sector={sector:04d}",
            "bucket": "aurora",
            "object_key": object_key,
            "product_kind": "TARGET_PIXEL",
            "schema_version": "silver-target-pixel-v1",
            "processor_version": "tpf-preprocess-v1",
            "sector": sector,
            "tic_id": tic_id,
            "camera": 1,
            "ccd": 1,
            "size_bytes": len(parquet_bytes),
            "sha256": sha256,
            "occurred_at": "2026-01-01T00:00:00Z",
        }
    )

    return parquet_bytes, sha256, event


def generate_catalog_bundle(
    tic_ids: list[int],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """Generate synthetic TIC, TOI, and TCE catalog records for given TIC IDs."""
    tic_rows = []
    toi_rows = []
    tce_rows = []

    for tic_id in tic_ids:
        tic_rows.append(
            {
                "tic_id": tic_id,
                "ra": 150.0 + (tic_id % 100) * 0.1,
                "dec": 25.0 + (tic_id % 50) * 0.1,
                "tmag": 10.5,
                "teff": 5770.0,
                "rad": 1.0,
                "mass": 1.0,
            }
        )
        if tic_id % 2 == 0:
            toi_rows.append(
                {
                    "toi_id": f"{tic_id}.01",
                    "tic_id": tic_id,
                    "period": 3.5,
                    "epoch": 1.2,
                    "depth_ppm": 15000.0,
                    "tfopwg_disp": "Confirmed Planet",
                }
            )
            tce_rows.append(
                {
                    "tce_id": f"tce-{tic_id}-1",
                    "tic_id": tic_id,
                    "sector": 1,
                    "period": 3.5,
                }
            )

    return tic_rows, toi_rows, tce_rows


def seed_catalogs(store: ObjectStore, bucket: str, tic_ids: list[int]) -> None:
    """Import synthetic TIC, TOI, and TCE catalogs into the ObjectStore."""
    tic_rows, toi_rows, tce_rows = generate_catalog_bundle(tic_ids)
    import_catalog_rows(
        store, bucket, "TIC", tic_rows, provider="simulated", source_uri="sim://tic"
    )
    import_catalog_rows(
        store, bucket, "TOI", toi_rows, provider="simulated", source_uri="sim://toi"
    )
    import_catalog_rows(
        store, bucket, "TCE", tce_rows, provider="simulated", source_uri="sim://tce"
    )


def generate_lineage_record(event: SilverEvent) -> dict[str, Any]:
    """Generate a valid durable lineage JSON document for an admitted Silver event."""
    return {
        "lineage_id": f"lineage-{event.event_id}",
        "status": "LINEAGE_COMMITTED",
        "source": {"source_product_id": event.source_product_id},
        "bronze": {
            "product_kind": event.product_kind,
            "sector": event.sector,
            "tic_id": event.tic_id,
        },
        "processing": {
            "processor_version": event.processor_version,
            "product_kind": event.product_kind,
        },
        "silver": {
            "bucket": event.bucket,
            "object_key": event.object_key,
            "size_bytes": event.size_bytes,
            "sha256": event.sha256,
            "schema_version": event.schema_version,
        },
    }
